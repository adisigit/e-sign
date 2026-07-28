"use strict";
// ============================================================
// ablation-diversified.js  (Test #6)
//
// Extends the fixed 5%-attack-ratio, fixed-pattern ablation with:
//   - varying attack ratios (1%, 5%, 10%, 25%)
//   - random target selection (seeded, for reproducibility)
//   - a pool of mutation classes (via tamper-pdc-record.js), not just
//     a single field-value change
//   - two-way comparison per probe: content-only vs dual-layer, derived
//     from a single dual-layer response (see classifyBaselines() below).
//
// PREREQUISITE: docs DOCS-0-<roundTag>-1..N must already be registered
// (via Caliper or your normal registration flow) BEFORE running this
// script, since tampering mutates already-committed records.
//
// USAGE:
//   API_AUTH_TOKEN=xxx SEED=<unique_per_replication> \
//     COUCHDB_USER=... COUCHDB_PASS=... COUCHDB_DB=... \
//     node ablation-diversified.js
// ============================================================

const axios = require("axios");
const fs = require("fs");
const { tamperBatch } = require("./tamper-pdc-record");

const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  mode: "two-layer", // always use the dual-layer endpoint; baselines are derived from layer1/layer2
  docsPerRun: Number(process.env.DOCS_PER_RUN || 100),
  attackRatios: [0.01, 0.05, 0.1, 0.25],
  seed: Number(process.env.SEED || 42),
  // Global round counter. Every ratio (and every replication, if you add
  // one) consumes exactly one round number and moves the counter forward,
  // so docIDs never collide -- not across ratios within a run, and not
  // across separate invocations of this script either, as long as you
  // pass the printed "next START_ROUND" value into the next run.
  startRound: Number(process.env.START_ROUND || 0),
};

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

const MUTATION_POOL = [
  // schema-valid, hash-mismatch class -> expect PDC_RECORD_COMPROMISED
  "change_permitted_value",
  "change_description",
  "substitute_document_hash",
  "change_category",
  // schema-invalid class -> expect PDC_RECORD_SCHEMA_VIOLATION
  "remove_required_field",
  "add_unknown_field",
  "null_required_field",
  "wrong_document_id_binding",
  "wrong_collection_binding",
  "malformed_hash_length",
  "malformed_timestamp",
];

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

async function sendVerify(documentID) {
  const content = `Document content`;
  const fileBase64 = Buffer.from(content).toString("base64");
  const start = Date.now();
  try {
    const res = await axios.post(
      ENDPOINTS[CONFIG.mode],
      { id: documentID, file: fileBase64 },
      {
        headers: { Authorization: `Bearer ${CONFIG.authToken}`, "Content-Type": "application/json" },
        timeout: 10000,
      }
    );
    return { ok: true, documentID, data: res.data, latency: Date.now() - start };
  } catch (err) {
    return { ok: false, documentID, error: err.message, latency: Date.now() - start };
  }
}

// ---- derive content-only baseline from a single dual-layer response,
function classifyBaselines(responseData) {
  const layer1 = responseData?.layer1;
  const layer2 = responseData?.layer2;

  return {
    // a record-tampering signal in the first place)
    contentOnlyDetected: layer1 === true && layer2 === false,
    // dual-layer: whatever the chaincode's combined status says
    dualLayerDetected: responseData?.status !== "INTACT",
  };
}

async function runRound(roundTag, docsPerRun, attackRatio, rng, seed) {
  const allDocIDs = Array.from({ length: docsPerRun }, (_, i) => `DOCS-0-${roundTag}-${i + 1}`);
  const shuffled = shuffle(allDocIDs, rng);
  const attackCount = Math.max(1, Math.round(docsPerRun * attackRatio));
  const targetDocIDs = shuffled.slice(0, attackCount);

  console.log(
    `\n--- Round tag=${roundTag} seed=${seed} ratio=${(attackRatio * 100).toFixed(0)}% targets=${attackCount} ---`
  );

  const tamperLog = await tamperBatch(targetDocIDs, MUTATION_POOL);
  const tamperedSet = new Set(tamperLog.filter((r) => r.ok).map((r) => r.docID));
  const tamperFailures = tamperLog.filter((r) => !r.ok);
  if (tamperFailures.length > 0) {
    console.warn(`⚠️ ${tamperFailures.length} tamper attempts failed, excluding from ground truth`);
  }

  const metrics = {
    contentOnly: { TP: 0, TN: 0, FP: 0, FN: 0 },
    dualLayer: { TP: 0, TN: 0, FP: 0, FN: 0 },
    total: 0,
    perDocDetail: [],
  };

  for (const documentID of allDocIDs) {
    const r = await sendVerify(documentID);
    if (!r.ok) continue;
    metrics.total++;

    const actualTampered = tamperedSet.has(documentID);
    const { contentOnlyDetected, dualLayerDetected } = classifyBaselines(r.data);

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

    if (actualTampered) {
      metrics.perDocDetail.push({
        documentID,
        mutation: tamperLog.find((t) => t.docID === documentID)?.mutationName,
        status: r.data?.status,
      });
    }
  }

  const withMetrics = (m) => {
    const accuracy = (m.TP + m.TN) / (metrics.total || 1);
    const precision = m.TP / (m.TP + m.FP || 1);
    const recall = m.TP / (m.TP + m.FN || 1);
    const f1 = (2 * precision * recall) / (precision + recall || 1);
    return { ...m, accuracy, precision, recall, f1 };
  };

  const result = {
    roundTag,
    seed,
    attackRatio,
    total: metrics.total,
    tamperedCount: tamperedSet.size,
    contentOnly: withMetrics(metrics.contentOnly),
    dualLayer: withMetrics(metrics.dualLayer),
    perDocDetail: metrics.perDocDetail,
  };

  console.log(
    `  content-only  recall=${(result.contentOnly.recall * 100).toFixed(1)}%  precision=${(result.contentOnly.precision * 100).toFixed(1)}%`
  );
  console.log(
    `  dual-layer    recall=${(result.dualLayer.recall * 100).toFixed(1)}%  precision=${(result.dualLayer.precision * 100).toFixed(1)}%`
  );

  return result;
}

async function main() {
  const rng = mulberry32(CONFIG.seed);
  const allResults = [];
  let currentRound = CONFIG.startRound;

  console.log(
    `Starting from round ${currentRound}, seed=${CONFIG.seed} ` +
      `(if this run is interrupted, resume with START_ROUND=${currentRound} SEED=${CONFIG.seed})\n`
  );

  for (const ratio of CONFIG.attackRatios) {
    const roundTag = currentRound; // one fresh round number per ratio -- never reused
    currentRound++;
    const result = await runRound(roundTag, CONFIG.docsPerRun, ratio, rng, CONFIG.seed);
    allResults.push(result);
  }

  const csvHeader =
    "round_tag,seed,attack_ratio,total,tampered_count,method,accuracy,precision,recall,f1\n";
  const csvRows = [];
  for (const r of allResults) {
    for (const method of ["contentOnly", "dualLayer"]) {
      const m = r[method];
      csvRows.push(
        [
          r.roundTag,
          r.seed,
          r.attackRatio,
          r.total,
          r.tamperedCount,
          method,
          (m.accuracy * 100).toFixed(2),
          (m.precision * 100).toFixed(2),
          (m.recall * 100).toFixed(2),
          (m.f1 * 100).toFixed(2),
        ].join(",")
      );
    }
  }

  // Append rather than overwrite, so results from separate replication runs
  // (different SEED / START_ROUND invocations) accumulate into one file
  // instead of clobbering each other.
  const csvPath = "ablation_diversified_results.csv";
  const csvExists = fs.existsSync(csvPath);
  fs.appendFileSync(csvPath, (csvExists ? "" : csvHeader) + csvRows.join("\n") + "\n");

  const jsonPath = "ablation_diversified_detail.json";
  const priorDetail = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : [];
  fs.writeFileSync(jsonPath, JSON.stringify([...priorDetail, ...allResults], null, 2));

  console.log(`\n✅ Appended to: ${csvPath} (seed=${CONFIG.seed})`);
  console.log(`✅ Appended to: ${jsonPath} (per-document mutation + detection detail)`);
  console.log(
    `\n👉 Next replication: START_ROUND=${currentRound} SEED=<new_unique_seed> node ablation-diversified.js`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
