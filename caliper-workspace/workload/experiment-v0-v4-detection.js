"use strict";

const axios = require("axios");
const fs = require("fs");
const {
  tamperBatch,
  snapshotBatch,
  restoreBatch,
} = require("./tamper-pdc-record");

const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  docsPerRun: Number(process.env.DOCS_PER_RUN || 100),
  documentPrefix: process.env.DOCUMENT_PREFIX || "DOCS-0-160-",
  attackRatios: (process.env.ATTACK_RATIOS || "0.01,0.05,0.1,0.25").split(",").map(Number),
  seed: Number(process.env.SEED || 42),
  startRound: Number(process.env.START_ROUND || 0),
  testType: process.env.TEST || "t2_only",
  harnessVersion: process.env.HARNESS_VERSION || "component-ablation-v2-reset",
};

if (!CONFIG.authToken) throw new Error("Missing API_AUTH_TOKEN");

const VARIANTS = ["V0", "V1", "V2", "V3", "V4"];
const VALID_TEST_TYPES = ["t1_only", "t2_only", "combined"];

if (!VALID_TEST_TYPES.includes(CONFIG.testType)) {
  throw new Error(`Invalid TEST=${CONFIG.testType}`);
}

const METADATA_ONLY_POOL = [
  "change_permitted_value",
  "change_description",
  "change_category",
  "remove_required_field",
  "add_unknown_field",
  "null_required_field",
  "wrong_document_id_binding",
  "wrong_collection_binding",
  "malformed_timestamp",
];

const COMBINED_RECORD_POOL = [
  ...METADATA_ONLY_POOL,
  "substitute_document_hash",
  "malformed_hash_length",
];

const COMBINED_SUB_CASES = ["content_only", "record_only", "both"];

const REGISTERED_CONTENT = "Document content";
const TAMPERED_CONTENT = "Document content-MODIFIED";

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
  const copy = [...arr];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function allDocumentIDs() {
  return Array.from(
    { length: CONFIG.docsPerRun },
    (_, i) => `${CONFIG.documentPrefix}${i + 1}`
  );
}

async function sendVerify(documentID, variant, useTamperedContent = false) {
  const content = useTamperedContent ? TAMPERED_CONTENT : REGISTERED_CONTENT;
  const file = Buffer.from(content).toString("base64");

  const endpoint =
    `${CONFIG.apiUrl}/api/document/verify-ablation/` +
    `${CONFIG.orgName}/ablate/${variant}`;

  const startedAt = process.hrtime.bigint();

  try {
    const res = await axios.post(
      endpoint,
      { id: documentID, file },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.authToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    return {
      ok: true,
      data: res.data,
      latencyMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.response?.data || err.message,
      latencyMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    };
  }
}

// V4 is sufficient as round-to-round cleanliness check because
// successful V4 requires schema + canonicalization + PDC hash + document hash.
async function assertV4Clean(docIDs, label = "baseline") {
  for (const documentID of docIDs) {
    const res = await sendVerify(documentID, "V4", false);

    if (!res.ok) {
      throw new Error(`${label}: V4 request failed for ${documentID}`);
    }

    if (res.data?.status !== "INTACT") {
      throw new Error(
        `${label}: ${documentID} is not clean; expected INTACT, got ${res.data?.status}`
      );
    }
  }

  console.log(`✅ ${label}: ${docIDs.length}/${docIDs.length} V4 INTACT`);
}

function resolveScenario(testType) {
  if (testType === "t1_only") {
    return { tamperRecord: false, independentAssignment: false, pool: null };
  }

  if (testType === "t2_only") {
    return { tamperRecord: true, independentAssignment: false, pool: METADATA_ONLY_POOL };
  }

  return { tamperRecord: true, independentAssignment: true, pool: COMBINED_RECORD_POOL };
}

function emptyMetrics() {
  return { TP: 0, TN: 0, FP: 0, FN: 0 };
}

function updateMetrics(m, actualTampered, detected) {
  if (actualTampered && detected) m.TP++;
  else if (!actualTampered && !detected) m.TN++;
  else if (actualTampered && !detected) m.FN++;
  else m.FP++;
}

function safeDiv(a, b) {
  return b === 0 ? null : a / b;
}

function finalizeMetrics(m) {
  const total = m.TP + m.TN + m.FP + m.FN;
  const accuracy = safeDiv(m.TP + m.TN, total);
  const precision = safeDiv(m.TP, m.TP + m.FP);
  const recall = safeDiv(m.TP, m.TP + m.FN);
  const specificity = safeDiv(m.TN, m.TN + m.FP);
  const falsePositiveRate = safeDiv(m.FP, m.FP + m.TN);

  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);

  return {
    ...m,
    accuracy,
    precision,
    recall,
    specificity,
    falsePositiveRate,
    f1,
  };
}

async function runRound(roundTag, attackRatio, seed, testType) {
  const scenario = resolveScenario(testType);
  const rng = mulberry32(seed + Number(roundTag));
  const allDocIDs = allDocumentIDs();

  console.log(
    `\n=== ${testType} round=${roundTag} seed=${seed} ratio=${attackRatio} ===`
  );

  await assertV4Clean(allDocIDs, "pre-round");

  const attackCount = Math.max(
    1,
    Math.round(CONFIG.docsPerRun * attackRatio)
  );

  const targetDocIDs = shuffle(allDocIDs, rng).slice(0, attackCount);
  const subCaseByDoc = new Map();

  for (const docID of targetDocIDs) {
    if (scenario.independentAssignment) {
      const index = Math.floor(rng() * COMBINED_SUB_CASES.length);
      subCaseByDoc.set(docID, COMBINED_SUB_CASES[index]);
    } else {
      subCaseByDoc.set(
        docID,
        scenario.tamperRecord ? "record_only" : "content_only"
      );
    }
  }

  const recordTargets = targetDocIDs.filter((docID) => {
    const subCase = subCaseByDoc.get(docID);
    return subCase === "record_only" || subCase === "both";
  });

  const snapshots =
    recordTargets.length > 0
      ? await snapshotBatch(recordTargets)
      : {};

  const recordTamperedSet = new Set();
  const tamperInfoByDoc = new Map();

  let experimentError = null;
  let result = null;

  try {
    if (recordTargets.length > 0) {
      const mutationPool = scenario.independentAssignment
        ? COMBINED_RECORD_POOL
        : scenario.pool;

      const tamperLog = await tamperBatch(
        recordTargets,
        mutationPool,
        { rng }
      );

      for (const row of tamperLog) {
        if (!row.ok) continue;

        const documentID = row.docID || row.documentID;
        const mutationSubtype =
          row.mutationSubtype || row.mutationName || row.mutation || row.type;

        if (!documentID || !mutationSubtype) {
          throw new Error("Invalid tamperBatch result");
        }

        recordTamperedSet.add(documentID);

        tamperInfoByDoc.set(documentID, {
          mutationSubtype,
          mutatedField: row.mutatedField || row.field || row.fieldName || null,
        });
      }
    }

    const tamperedSet = new Set();
    const effectiveSubCase = new Map();

    for (const documentID of targetDocIDs) {
      const intended = subCaseByDoc.get(documentID);
      const recordSucceeded = recordTamperedSet.has(documentID);

      if (intended === "content_only") {
        tamperedSet.add(documentID);
        effectiveSubCase.set(documentID, "content_only");
      }

      if (intended === "record_only" && recordSucceeded) {
        tamperedSet.add(documentID);
        effectiveSubCase.set(documentID, "record_only");
      }

      if (intended === "both") {
        tamperedSet.add(documentID);
        effectiveSubCase.set(
          documentID,
          recordSucceeded ? "both" : "content_only"
        );
      }
    }

    const metrics = Object.fromEntries(
      VARIANTS.map((v) => [v, emptyMetrics()])
    );

    const byMutation = {};
    const bySubCase = {};
    const perDocDetail = [];

    for (const documentID of allDocIDs) {
      const actualTampered = tamperedSet.has(documentID);
      const subCase =
        effectiveSubCase.get(documentID) || "untampered";

      const contentMismatch =
        subCase === "content_only" || subCase === "both";

      const tamperInfo = tamperInfoByDoc.get(documentID);

      const mutationSubtype =
        tamperInfo?.mutationSubtype ||
        (contentMismatch ? "document_content_modified" : null);

      const variantResults = {};

      for (const variant of VARIANTS) {
        const response = await sendVerify(
          documentID,
          variant,
          contentMismatch
        );

        if (!response.ok) {
          throw new Error(
            `Verifier failed doc=${documentID}, variant=${variant}: ` +
            JSON.stringify(response.error)
          );
        }

        const detected = response.data?.detected === true;

        updateMetrics(
          metrics[variant],
          actualTampered,
          detected
        );

        variantResults[variant] = {
          detected,
          status: response.data?.status,
        };
      }

      if (actualTampered && mutationSubtype) {
        if (!byMutation[mutationSubtype]) {
          byMutation[mutationSubtype] = {
            count: 0,
            variants: Object.fromEntries(
              VARIANTS.map((v) => [v, { detected: 0 }])
            ),
          };
        }

        byMutation[mutationSubtype].count++;

        for (const variant of VARIANTS) {
          if (variantResults[variant].detected) {
            byMutation[mutationSubtype].variants[variant].detected++;
          }
        }
      }

      if (!bySubCase[subCase]) {
        bySubCase[subCase] = {
          count: 0,
          variants: Object.fromEntries(
            VARIANTS.map((v) => [v, { detected: 0 }])
          ),
        };
      }

      bySubCase[subCase].count++;

      for (const variant of VARIANTS) {
        if (variantResults[variant].detected) {
          bySubCase[subCase].variants[variant].detected++;
        }
      }

      const hasFalsePositive =
        !actualTampered &&
        VARIANTS.some((variant) => variantResults[variant].detected);

      if (actualTampered || hasFalsePositive) {
        perDocDetail.push({
          documentID,
          actualTampered,
          subCase,
          mutationSubtype,
          mutatedField: tamperInfo?.mutatedField || null,
          contentMismatched: contentMismatch,
          recordTampered: recordTamperedSet.has(documentID),
          variants: variantResults,
        });
      }
    }

    for (const data of Object.values(byMutation)) {
      for (const variant of VARIANTS) {
        data.variants[variant].recall =
          data.count === 0
            ? null
            : data.variants[variant].detected / data.count;
      }
    }

    for (const data of Object.values(bySubCase)) {
      for (const variant of VARIANTS) {
        data.variants[variant].rate =
          data.count === 0
            ? null
            : data.variants[variant].detected / data.count;
      }
    }

    result = {
      experimentMeta: {
        harnessVersion: CONFIG.harnessVersion,
        executedAt: new Date().toISOString(),
      },
      testType,
      roundTag,
      seed,
      attackRatio,
      total: CONFIG.docsPerRun,
      tamperedCount: tamperedSet.size,
      metrics: Object.fromEntries(
        VARIANTS.map((v) => [v, finalizeMetrics(metrics[v])])
      ),
      byMutation,

      ...(testType === "combined"
        ? {
            bySubCase,
            perDocDetail,
          }
        : {}),
    };
  } catch (err) {
    experimentError = err;
  }

  if (recordTargets.length > 0) {
    console.log(`Restoring ${recordTargets.length} PDC record(s)...`);

    const restoreResults = await restoreBatch(snapshots);
    const restoreFailures = restoreResults.filter((r) => !r.ok);

    if (restoreFailures.length > 0) {
      throw new Error(
        `RESTORE FAILED: ${JSON.stringify(restoreFailures)}`
      );
    }

    await assertV4Clean(recordTargets, "post-restore");
  }

  if (experimentError) throw experimentError;

  return result;
}

function metric(v) {
  return v === null || v === undefined
    ? "NA"
    : (v * 100).toFixed(2);
}

async function main() {
  const results = [];
  let round = CONFIG.startRound;

  for (const attackRatio of CONFIG.attackRatios) {
    const result = await runRound(
      String(round),
      attackRatio,
      CONFIG.seed,
      CONFIG.testType
    );

    results.push(result);

    console.log(`\nRound ${round}`);
    for (const variant of VARIANTS) {
      const m = result.metrics[variant];
      console.log(
        `${variant}: accuracy=${metric(m.accuracy)}% ` +
        `precision=${metric(m.precision)}% ` +
        `recall=${metric(m.recall)}% F1=${metric(m.f1)}%`
      );
    }

    round++;
  }

  const jsonPath = `component_ablation_${CONFIG.testType}_detail.json`;
  const csvPath = `component_ablation_${CONFIG.testType}_results.csv`;

  const previous = fs.existsSync(jsonPath)
    ? JSON.parse(fs.readFileSync(jsonPath, "utf8"))
    : [];

  fs.writeFileSync(
    jsonPath,
    JSON.stringify([...previous, ...results], null, 2)
  );

  const header =
    "test_type,round_tag,seed,attack_ratio,total,tampered_count," +
    "variant,accuracy,precision,recall,specificity,false_positive_rate,f1\n";

  const rows = [];

  for (const r of results) {
    for (const variant of VARIANTS) {
      const m = r.metrics[variant];

      rows.push([
        r.testType,
        r.roundTag,
        r.seed,
        r.attackRatio,
        r.total,
        r.tamperedCount,
        variant,
        metric(m.accuracy),
        metric(m.precision),
        metric(m.recall),
        metric(m.specificity),
        metric(m.falsePositiveRate),
        metric(m.f1),
      ].join(","));
    }
  }

  fs.appendFileSync(
    csvPath,
    (fs.existsSync(csvPath) ? "" : header) +
    rows.join("\n") +
    "\n"
  );

  console.log(`\nSaved: ${jsonPath}`);
  console.log(`Saved: ${csvPath}`);
  console.log(`Next START_ROUND=${round}`);
}

main().catch((err) => {
  console.error("\nEXPERIMENT ABORTED");
  console.error(err);
  process.exit(1);
});
