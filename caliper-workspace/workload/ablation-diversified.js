"use strict";
// ============================================================
// ablation-diversified.js  (Test #6, revised)
//
// USAGE:
//   API_AUTH_TOKEN=xxx SEED=<unique_per_replication> \
//     COUCHDB_USER=... COUCHDB_PASS=... COUCHDB_DB=... \
//     TEST=t1_only|t2_only|combined \
//     node ablation-diversified.js
//
//   Run all three by invoking three times with TEST set differently,
//   each with its own SEED/START_ROUND continuation as before.
// ============================================================

const axios = require("axios");
const fs = require("fs");
const { tamperBatch } = require("./tamper-pdc-record");

const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  docsPerRun: Number(process.env.DOCS_PER_RUN || 100),
  attackRatios: [0.01, 0.05, 0.1, 0.25],
  seed: Number(process.env.SEED || 42),
  // Global round counter. Every ratio (and every replication, if you add
  // one) consumes exactly one round number and moves the counter forward,
  // so docIDs never collide -- not across ratios within a run, and not
  // across separate invocations of this script either, as long as you
  // pass the printed "next START_ROUND" value into the next run.
  startRound: Number(process.env.START_ROUND || 0),
  // Which of the three scenarios to run this invocation.
  testType: process.env.TEST || "t2_only",
};

const VALID_TEST_TYPES = ["t1_only", "t2_only", "combined"];
if (!VALID_TEST_TYPES.includes(CONFIG.testType)) {
  console.error(`❌ Invalid TEST=${CONFIG.testType}. Must be one of: ${VALID_TEST_TYPES.join(", ")}`);
  process.exit(1);
}

if (!CONFIG.authToken) {
  console.error("❌ Missing API_AUTH_TOKEN");
  process.exit(1);
}

if (!process.env.SEED) {
  console.warn(
    `⚠️  SEED not set, falling back to default (${CONFIG.seed}). ` +
      `If this is meant to be an independent replication of a prior run, ` +
      `set SEED explicitly to a value not used before.`
  );
}

const ENDPOINTS = {
  "one-layer": `${CONFIG.apiUrl}/api/document/webhook/${CONFIG.orgName}/integrity`,
  "two-layer": `${CONFIG.apiUrl}/api/document/${CONFIG.orgName}/integrity-short-circuit`,
};

const METADATA_ONLY_POOL = [
  // schema-valid, hash-mismatch class -> expect PDC_RECORD_COMPROMISED
  "change_permitted_value",
  "change_description",
  "change_category",
  // schema-invalid class -> expect PDC_RECORD_SCHEMA_VIOLATION
  "remove_required_field",
  "add_unknown_field",
  "null_required_field",
  "wrong_document_id_binding",
  "wrong_collection_binding",
  "malformed_timestamp",
];


const COMBINED_RECORD_POOL = [...METADATA_ONLY_POOL, "substitute_document_hash", "malformed_hash_length"];

const COMBINED_SUB_CASES = ["content_only", "record_only", "both"];

const REGISTERED_CONTENT = "Document content";
const TAMPERED_CONTENT = "Document content-MODIFIED";

// ---- simple seeded PRNG for reproducible random target selection ----
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// `useTamperedContent`: whether the bytes sent at verify-time should
// differ from what was registered (simulates T1 at the client side).
async function sendVerify(documentID, mode, useTamperedContent) {
  const content = useTamperedContent ? TAMPERED_CONTENT : REGISTERED_CONTENT;
  const fileBase64 = Buffer.from(content).toString("base64");
  const start = Date.now();
  try {
    const res = await axios.post(
      ENDPOINTS[mode],
      { id: documentID, file: fileBase64 },
      {
        headers: { Authorization: `Bearer ${CONFIG.authToken}`, "Content-Type": "application/json" },
        timeout: 10000,
      }
    );
    return { ok: true, mode, documentID, data: res.data, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, mode, documentID, error: err.message, latency: Date.now() - start };
  }
}

function isContentOnlyDetected(oneLayerData) {
  return oneLayerData?.isDocumentValid === false;
}

function isDualLayerDetected(twoLayerData) {
  return twoLayerData?.status !== "INTACT";
}

function resolveScenario(testType) {
  switch (testType) {
    case "t1_only":
      return { independentAssignment: false, tamperRecord: false, tamperContent: true, pool: null };
    case "t2_only":
      return { independentAssignment: false, tamperRecord: true, tamperContent: false, pool: METADATA_ONLY_POOL };
    case "combined":
      return { independentAssignment: true, pool: COMBINED_RECORD_POOL };
    default:
      throw new Error(`unknown testType ${testType}`);
  }
}

async function runRound(roundTag, docsPerRun, attackRatio, rng, seed, testType) {
  const scenario = resolveScenario(testType);

  const allDocIDs = Array.from({ length: docsPerRun }, (_, i) => `DOCS-0-${roundTag}-${i + 1}`);
  const shuffled = shuffle(allDocIDs, rng);
  const attackCount = Math.max(1, Math.round(docsPerRun * attackRatio));
  const targetDocIDs = shuffled.slice(0, attackCount);

  console.log(
    `\n--- [${testType}] Round tag=${roundTag} seed=${seed} ratio=${(attackRatio * 100).toFixed(0)}% targets=${targetDocIDs.length} ---`
  );

  const subCaseByDoc = new Map();
  if (scenario.independentAssignment) {
    for (const docID of targetDocIDs) {
      const idx = Math.floor(rng() * COMBINED_SUB_CASES.length);
      subCaseByDoc.set(docID, COMBINED_SUB_CASES[idx]);
    }
  } else {
    const fixedSubCase = scenario.tamperRecord ? "record_only" : "content_only";
    for (const docID of targetDocIDs) subCaseByDoc.set(docID, fixedSubCase);
  }

  const docsNeedingRecordTamper = targetDocIDs.filter((id) => {
    const sc = subCaseByDoc.get(id);
    return sc === "record_only" || sc === "both";
  });

  let recordTamperedSet = new Set();
  if (docsNeedingRecordTamper.length > 0) {
    const pool = scenario.independentAssignment ? COMBINED_RECORD_POOL : scenario.pool;
    const tamperLog = await tamperBatch(docsNeedingRecordTamper, pool, { rng });
    recordTamperedSet = new Set(tamperLog.filter((r) => r.ok).map((r) => r.docID));
    const tamperFailures = tamperLog.filter((r) => !r.ok);
    if (tamperFailures.length > 0) {
      console.warn(`⚠️ ${tamperFailures.length} tamper attempts failed, excluding from ground truth`);
    }
  }

  const tamperedSet = new Set();
  const subCaseOutcomeByDoc = new Map(); // effective sub-case actually achieved
  for (const docID of targetDocIDs) {
    const intended = subCaseByDoc.get(docID);
    const recordTamperSucceeded = recordTamperedSet.has(docID);
    if (intended === "content_only") {
      tamperedSet.add(docID);
      subCaseOutcomeByDoc.set(docID, "content_only");
    } else if (intended === "record_only") {
      if (recordTamperSucceeded) {
        tamperedSet.add(docID);
        subCaseOutcomeByDoc.set(docID, "record_only");
      } else {
        subCaseOutcomeByDoc.set(docID, "record_only_FAILED_untampered");
      }
    } else if (intended === "both") {
      tamperedSet.add(docID); // content mismatch alone guarantees this
      subCaseOutcomeByDoc.set(docID, recordTamperSucceeded ? "both" : "both_recordTamperFailed_contentOnlyActual");
    }
  }

  const metrics = {
    contentOnly: { TP: 0, TN: 0, FP: 0, FN: 0 },
    dualLayer: { TP: 0, TN: 0, FP: 0, FN: 0 },
    total: 0,
    perDocDetail: [],
    bySubCase: {},
  };

  for (const documentID of allDocIDs) {
    const actualTampered = tamperedSet.has(documentID);
    const outcome = subCaseOutcomeByDoc.get(documentID) || null; // null for untampered docs
    const sendMismatchedContent =
      actualTampered && (outcome === "content_only" || outcome?.startsWith("both"));

    const [oneLayerRes, twoLayerRes] = await Promise.all([
      sendVerify(documentID, "one-layer", sendMismatchedContent),
      sendVerify(documentID, "two-layer", sendMismatchedContent),
    ]);
    if (!oneLayerRes.ok || !twoLayerRes.ok) {
      if (!oneLayerRes.ok) console.warn(`  ⚠️ one-layer call failed for ${documentID}: ${oneLayerRes.error}`);
      if (!twoLayerRes.ok) console.warn(`  ⚠️ two-layer call failed for ${documentID}: ${twoLayerRes.error}`);
      continue;
    }
    metrics.total++;

    const contentOnlyDetected = isContentOnlyDetected(oneLayerRes.data);
    const dualLayerDetected = isDualLayerDetected(twoLayerRes.data);

    for (const [name, detected] of [
      ["contentOnly", contentOnlyDetected],
      ["dualLayer", dualLayerDetected],
    ]) {
      const m = metrics[name];
      if (actualTampered && detected) m.TP++;
      else if (!actualTampered && !detected) m.TN++;
      else if (actualTampered && !detected) m.FN++;
      else m.FP++;
    }

    const subCaseKey = actualTampered ? outcome : "untampered";
    if (!metrics.bySubCase[subCaseKey]) {
      metrics.bySubCase[subCaseKey] = {
        contentOnly: { TP: 0, TN: 0, FP: 0, FN: 0 },
        dualLayer: { TP: 0, TN: 0, FP: 0, FN: 0 },
        count: 0,
      };
    }
    metrics.bySubCase[subCaseKey].count++;
    for (const [name, detected] of [
      ["contentOnly", contentOnlyDetected],
      ["dualLayer", dualLayerDetected],
    ]) {
      const m = metrics.bySubCase[subCaseKey][name];
      if (actualTampered && detected) m.TP++;
      else if (!actualTampered && !detected) m.TN++;
      else if (actualTampered && !detected) m.FN++;
      else m.FP++;
    }

    if (actualTampered) {
      metrics.perDocDetail.push({
        documentID,
        testType,
        subCase: outcome,
        contentMismatched: sendMismatchedContent,
        recordTampered: recordTamperedSet.has(documentID),
        oneLayerValid: oneLayerRes.data?.isDocumentValid,
        twoLayerStatus: twoLayerRes.data?.status,
        twoLayerFailedLayer: twoLayerRes.data?.failedLayer ?? null,
        oneLayerLatency: oneLayerRes.latency,
        twoLayerLatency: twoLayerRes.latency,
      });
    }
  }

  const withMetrics = (m, total) => {
    const denom = total ?? metrics.total;
    const accuracy = (m.TP + m.TN) / (denom || 1);
    const precision = m.TP / (m.TP + m.FP || 1);
    const recall = m.TP / (m.TP + m.FN || 1);
    const f1 = (2 * precision * recall) / (precision + recall || 1);
    return { ...m, accuracy, precision, recall, f1 };
  };

  const bySubCaseWithMetrics = {};
  for (const [key, val] of Object.entries(metrics.bySubCase)) {
    bySubCaseWithMetrics[key] = {
      count: val.count,
      contentOnly: withMetrics(val.contentOnly, val.count),
      dualLayer: withMetrics(val.dualLayer, val.count),
    };
  }

  const result = {
    testType,
    roundTag,
    seed,
    attackRatio,
    total: metrics.total,
    tamperedCount: tamperedSet.size,
    contentOnly: withMetrics(metrics.contentOnly),
    dualLayer: withMetrics(metrics.dualLayer),
    bySubCase: bySubCaseWithMetrics,
    perDocDetail: metrics.perDocDetail,
  };

  console.log(
    `  content-only  recall=${(result.contentOnly.recall * 100).toFixed(1)}%  precision=${(result.contentOnly.precision * 100).toFixed(1)}%`
  );
  console.log(
    `  dual-layer    recall=${(result.dualLayer.recall * 100).toFixed(1)}%  precision=${(result.dualLayer.precision * 100).toFixed(1)}%`
  );
  if (scenario.independentAssignment) {
    for (const [key, val] of Object.entries(bySubCaseWithMetrics)) {
      console.log(
        `    [${key}] n=${val.count}  content-only recall=${(val.contentOnly.recall * 100).toFixed(1)}%  ` +
          `dual-layer recall=${(val.dualLayer.recall * 100).toFixed(1)}%`
      );
    }
  }

  return result;
}

async function main() {
  const rng = mulberry32(CONFIG.seed);
  const allResults = [];
  let currentRound = CONFIG.startRound;

  console.log(
    `Starting TEST=${CONFIG.testType} from round ${currentRound}, seed=${CONFIG.seed} ` +
      `(if this run is interrupted, resume with START_ROUND=${currentRound} SEED=${CONFIG.seed} TEST=${CONFIG.testType})\n`
  );

  for (const ratio of CONFIG.attackRatios) {
    const roundTag = `${currentRound}`; // fresh round tag per ratio, per test type
    currentRound++;
    const result = await runRound(roundTag, CONFIG.docsPerRun, ratio, rng, CONFIG.seed, CONFIG.testType);
    allResults.push(result);
  }

  const csvHeader =
    "test_type,round_tag,seed,attack_ratio,total,tampered_count,method,sub_case,accuracy,precision,recall,f1\n";
  const csvRows = [];
  for (const r of allResults) {
    for (const method of ["contentOnly", "dualLayer"]) {
      const m = r[method];
      csvRows.push(
        [
          r.testType,
          r.roundTag,
          r.seed,
          r.attackRatio,
          r.total,
          r.tamperedCount,
          method,
          "ALL",
          (m.accuracy * 100).toFixed(2),
          (m.precision * 100).toFixed(2),
          (m.recall * 100).toFixed(2),
          (m.f1 * 100).toFixed(2),
        ].join(",")
      );
    }
    for (const [subCase, val] of Object.entries(r.bySubCase || {})) {
      for (const method of ["contentOnly", "dualLayer"]) {
        const m = val[method];
        csvRows.push(
          [
            r.testType,
            r.roundTag,
            r.seed,
            r.attackRatio,
            val.count,
            subCase === "untampered" ? 0 : val.count,
            method,
            subCase,
            (m.accuracy * 100).toFixed(2),
            (m.precision * 100).toFixed(2),
            (m.recall * 100).toFixed(2),
            (m.f1 * 100).toFixed(2),
          ].join(",")
        );
      }
    }
  }

  const csvPath = `ablation_${CONFIG.testType}_results.csv`;
  const csvExists = fs.existsSync(csvPath);
  fs.appendFileSync(csvPath, (csvExists ? "" : csvHeader) + csvRows.join("\n") + "\n");

  const jsonPath = `ablation_${CONFIG.testType}_detail.json`;
  const priorDetail = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : [];
  fs.writeFileSync(jsonPath, JSON.stringify([...priorDetail, ...allResults], null, 2));

  console.log(`\n✅ Appended to: ${csvPath} (seed=${CONFIG.seed})`);
  console.log(`✅ Appended to: ${jsonPath} (per-document mutation + detection detail)`);
  console.log(
    `\n👉 Next replication: START_ROUND=${currentRound} SEED=<new_unique_seed> TEST=${CONFIG.testType} node ablation-diversified.js`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
