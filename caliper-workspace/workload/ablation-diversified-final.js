"use strict";

const axios = require("axios");
const fs = require("fs");
const { tamperBatch } = require("./tamper-pdc-record");

const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  docsPerRun: Number(process.env.DOCS_PER_RUN || 100),
  attackRatios: (process.env.ATTACK_RATIOS || "0.01,0.05,0.1,0.25")
    .split(",")
    .map(Number),
  seed: Number(process.env.SEED || 42),
  startRound: Number(process.env.START_ROUND || 0),
  testType: process.env.TEST || "t2_only",
  harnessVersion: process.env.HARNESS_VERSION || "ablation-v3",
};

const VALID_TEST_TYPES = ["t1_only", "t2_only", "combined"];

if (!VALID_TEST_TYPES.includes(CONFIG.testType)) {
  throw new Error(`Invalid TEST=${CONFIG.testType}`);
}

if (!CONFIG.authToken) {
  throw new Error("Missing API_AUTH_TOKEN");
}

const ENDPOINTS = {
  oneLayer:
    `${CONFIG.apiUrl}/api/document/webhook/${CONFIG.orgName}/integrity`,

  twoLayer:
    `${CONFIG.apiUrl}/api/document/${CONFIG.orgName}/integrity-short-circuit`,
};

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

const COMBINED_SUB_CASES = [
  "content_only",
  "record_only",
  "both",
];

const EXPECTED_RECORD_STATUS = {
  change_permitted_value: "PDC_RECORD_COMPROMISED",
  change_description: "PDC_RECORD_COMPROMISED",
  change_category: "PDC_RECORD_COMPROMISED",

  remove_required_field: "PDC_RECORD_SCHEMA_VIOLATION",
  add_unknown_field: "PDC_RECORD_SCHEMA_VIOLATION",
  null_required_field: "PDC_RECORD_SCHEMA_VIOLATION",
  wrong_document_id_binding: "PDC_RECORD_SCHEMA_VIOLATION",
  wrong_collection_binding: "PDC_RECORD_SCHEMA_VIOLATION",
  malformed_timestamp: "PDC_RECORD_SCHEMA_VIOLATION",

  substitute_document_hash: "PDC_RECORD_COMPROMISED",
  malformed_hash_length: "PDC_RECORD_SCHEMA_VIOLATION",
};

const REGISTERED_CONTENT = "Document content";
const TAMPERED_CONTENT = "Document content-MODIFIED";


function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(
      seed ^ (seed >>> 15),
      1 | seed
    );
    t =
      (t + Math.imul(
        t ^ (t >>> 7),
        61 | t
      )) ^ t;
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

async function sendVerify(documentID, mode, useTamperedContent) {
  const content = useTamperedContent
    ? TAMPERED_CONTENT
    : REGISTERED_CONTENT;

  const fileBase64 =
    Buffer.from(content).toString("base64");

  const endpoint =
    mode === "oneLayer"
      ? ENDPOINTS.oneLayer
      : ENDPOINTS.twoLayer;

  const start = process.hrtime.bigint();

  try {
    const res = await axios.post(
      endpoint,
      {
        id: documentID,
        file: fileBase64,
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.authToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    return {
      ok: true,
      data: res.data,
      latencyMs:
        Number(process.hrtime.bigint() - start) / 1e6,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.response?.data || err.message,
      latencyMs:
        Number(process.hrtime.bigint() - start) / 1e6,
    };
  }
}

async function assertCleanBaseline(allDocIDs) {
  for (const documentID of allDocIDs) {
    const res =
      await sendVerify(
        documentID,
        "twoLayer",
        false
      );

    if (!res.ok) {
      throw new Error(
        `Baseline request failed for ${documentID}`
      );
    }

    if (res.data?.status !== "INTACT") {
      throw new Error(
        `Dirty baseline for ${documentID}: ` +
        `expected INTACT, got ${res.data?.status}`
      );
    }
  }

  console.log(
    `  baseline: ${allDocIDs.length}/${allDocIDs.length} INTACT`
  );
}

function resolveScenario(testType) {
  switch (testType) {
    case "t1_only":
      return {
        tamperRecord: false,
        independentAssignment: false,
        pool: null,
      };

    case "t2_only":
      return {
        tamperRecord: true,
        independentAssignment: false,
        pool: METADATA_ONLY_POOL,
      };

    case "combined":
      return {
        independentAssignment: true,
        pool: COMBINED_RECORD_POOL,
      };

    default:
      throw new Error(`Unknown testType ${testType}`);
  }
}


function emptyMetrics() {
  return {
    TP: 0,
    TN: 0,
    FP: 0,
    FN: 0,
  };
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
  const total =
    m.TP + m.TN + m.FP + m.FN;

  const accuracy =
    safeDiv(m.TP + m.TN, total);

  const precision =
    safeDiv(m.TP, m.TP + m.FP);

  const recall =
    safeDiv(m.TP, m.TP + m.FN);

  const f1 =
    precision === null ||
    recall === null ||
    precision + recall === 0
      ? null
      : (2 * precision * recall) /
        (precision + recall);

  return {
    ...m,
    accuracy,
    precision,
    recall,
    f1,
  };
}

function expectedStatus(
  subCase,
  mutationSubtype
) {
  if (subCase === "content_only") {
    return "DOCUMENT_MODIFIED";
  }

  if (
    subCase === "record_only" ||
    subCase === "both"
  ) {
    return EXPECTED_RECORD_STATUS[mutationSubtype];
  }

  return "INTACT";
}

async function runRound(
  roundTag,
  attackRatio,
  seed,
  testType
) {
  const scenario =
    resolveScenario(testType);

  const rng =
    mulberry32(seed + Number(roundTag));

  const allDocIDs =
    Array.from(
      { length: CONFIG.docsPerRun },
      (_, i) =>
        `DOCS-0-${roundTag}-${i + 1}`
    );

  console.log(
    `\n[${testType}] round=${roundTag} ` +
    `seed=${seed} ratio=${attackRatio}`
  );

  await assertCleanBaseline(allDocIDs);

  const attackCount =
    Math.max(
      1,
      Math.round(
        CONFIG.docsPerRun *
        attackRatio
      )
    );

  const targetDocIDs =
    shuffle(allDocIDs, rng)
      .slice(0, attackCount);

  const subCaseByDoc =
    new Map();

  for (const docID of targetDocIDs) {
    if (scenario.independentAssignment) {
      const index =
        Math.floor(
          rng() *
          COMBINED_SUB_CASES.length
        );

      subCaseByDoc.set(
        docID,
        COMBINED_SUB_CASES[index]
      );
    } else {
      subCaseByDoc.set(
        docID,
        scenario.tamperRecord
          ? "record_only"
          : "content_only"
      );
    }
  }

  const recordTargets =
    targetDocIDs.filter((docID) => {
      const subCase =
        subCaseByDoc.get(docID);
      return (
        subCase === "record_only" ||
        subCase === "both"
      );
    });

  const recordTamperedSet =
    new Set();

  const tamperInfoByDoc =
    new Map();

  if (recordTargets.length > 0) {
    const pool =
      scenario.independentAssignment
        ? COMBINED_RECORD_POOL
        : scenario.pool;

    const tamperLog =
      await tamperBatch(
        recordTargets,
        pool,
        { rng }
      );

    for (const row of tamperLog) {
      if (!row.ok) continue;
      const docID =
        row.docID ||
        row.documentID;
      const mutationSubtype =
        row.mutationSubtype ||
        row.mutation ||
        row.type;
      const mutatedField =
        row.mutatedField ||
        row.field ||
        row.fieldName ||
        null;

      if (!docID) {
        throw new Error(
          "tamperBatch returned successful row without docID"
        );
      }

      if (!mutationSubtype) {
        throw new Error(
          `tamperBatch must return mutationSubtype for ${docID}`
        );
      }
      recordTamperedSet.add(docID);
      tamperInfoByDoc.set(
        docID,
        {
          mutationSubtype,
          mutatedField,
          raw: row,
        }
      );
    }
  }

  const tamperedSet =
    new Set();

  const effectiveSubCase =
    new Map();

  for (const docID of targetDocIDs) {
    const intended =
      subCaseByDoc.get(docID);
    const recordSucceeded =
      recordTamperedSet.has(docID);

    if (intended === "content_only") {
      tamperedSet.add(docID);
      effectiveSubCase.set(
        docID,
        "content_only"
      );
    }
    else if (intended === "record_only") {
      if (recordSucceeded) {
        tamperedSet.add(docID);
        effectiveSubCase.set(
          docID,
          "record_only"
        );
      }
    }
    else if (intended === "both") {
      tamperedSet.add(docID);
      effectiveSubCase.set(
        docID,
        recordSucceeded
          ? "both"
          : "content_only"
      );
    }
  }

  const contentMetrics =
    emptyMetrics();

  const twoStageMetrics =
    emptyMetrics();

  const byMutation = {};
  const perDocDetail = [];

  for (const documentID of allDocIDs) {
    const actualTampered =
      tamperedSet.has(documentID);
    const subCase =
      effectiveSubCase.get(documentID) ||
      "untampered";
    const contentMismatch =
      subCase === "content_only" ||
      subCase === "both";
    const tamperInfo =
      tamperInfoByDoc.get(documentID);
    const mutationSubtype =
      tamperInfo?.mutationSubtype ||
      (
        contentMismatch
          ? "document_content_modified"
          : null
      );

    const [
      oneLayerRes,
      twoLayerRes,
    ] = await Promise.all([
      sendVerify(
        documentID,
        "oneLayer",
        contentMismatch
      ),
      sendVerify(
        documentID,
        "twoLayer",
        contentMismatch
      ),
    ]);

    if (
      !oneLayerRes.ok ||
      !twoLayerRes.ok
    ) {
      throw new Error(
        `Verifier request failed for ${documentID}`
      );
    }
    const contentDetected =
      oneLayerRes.data?.isDocumentValid ===
      false;
    const twoStageDetected =
      twoLayerRes.data?.status !==
      "INTACT";
    updateMetrics(
      contentMetrics,
      actualTampered,
      contentDetected
    );
    updateMetrics(
      twoStageMetrics,
      actualTampered,
      twoStageDetected
    );

    if (
      testType === "t1_only" &&
      actualTampered &&
      twoLayerRes.data?.status !==
        "DOCUMENT_MODIFIED"
    ) {
      throw new Error(
        `T1 invariant failed for ${documentID}: ` +
        `got ${twoLayerRes.data?.status}`
      );
    }

    if (actualTampered) {
      const expected =
        expectedStatus(
          subCase,
          mutationSubtype
        );
      if (
        expected &&
        twoLayerRes.data?.status !== expected
      ) {
        throw new Error(
          `Unexpected two-stage status for ${documentID}: ` +
          `mutation=${mutationSubtype}, ` +
          `expected=${expected}, ` +
          `actual=${twoLayerRes.data?.status}`
        );
      }

      if (!byMutation[mutationSubtype]) {
        byMutation[mutationSubtype] = {
          count: 0,
          contentDetected: 0,
          twoStageDetected: 0,
        };
      }
      byMutation[mutationSubtype].count++;
      if (contentDetected) {
        byMutation[mutationSubtype]
          .contentDetected++;
      }
      if (twoStageDetected) {
        byMutation[mutationSubtype]
          .twoStageDetected++;
      }

      perDocDetail.push({
        documentID,
        testType,
        subCase,
        mutationSubtype,
        mutatedField:
          tamperInfo?.mutatedField ||
          null,
        contentMismatched:
          contentMismatch,
        recordTampered:
          recordTamperedSet.has(
            documentID
          ),
        contentOnlyValid:
          oneLayerRes.data
            ?.isDocumentValid,
        twoStageStatus:
          twoLayerRes.data
            ?.status,
        twoStageFailedLayer:
          twoLayerRes.data
            ?.failedLayer ??
          null,
        diagnosticLatencyMs: {
          contentOnly:
            oneLayerRes.latencyMs,
          twoStage:
            twoLayerRes.latencyMs,
        },
      });
    }
  }

  const mutationSummary = {};
  for (
    const [
      mutation,
      data,
    ] of Object.entries(byMutation)
  ) {
    mutationSummary[mutation] = {
      count:
        data.count,
      contentOnlyRecall:
        data.contentDetected /
        data.count,
      twoStageRecall:
        data.twoStageDetected /
        data.count,
    };
  }

  return {
    experimentMeta: {
      harnessVersion:
        CONFIG.harnessVersion,
      executedAt:
        new Date().toISOString(),
    },
    testType,
    roundTag,
    seed,
    attackRatio,
    total:
      CONFIG.docsPerRun,
    tamperedCount:
      tamperedSet.size,
    contentOnly:
      finalizeMetrics(
        contentMetrics
      ),
    twoStage:
      finalizeMetrics(
        twoStageMetrics
      ),
    byMutation:
      mutationSummary,
    perDocDetail,
  };
}

function metric(v) {
  if (
    v === null ||
    v === undefined
  ) {
    return "NA";
  }
  return (
    v *
    100
  ).toFixed(2);
}

async function main() {
  const results = [];

  let currentRound = CONFIG.startRound;
  for (
    const attackRatio
    of CONFIG.attackRatios
  ) {
    const result =
      await runRound(
        String(currentRound),
        attackRatio,
        CONFIG.seed,
        CONFIG.testType
      );
    results.push(result);
    currentRound++;
  }

  const jsonPath =
    `ablation_${CONFIG.testType}_detail.json`;
  const previous =
    fs.existsSync(jsonPath)
      ? JSON.parse(
          fs.readFileSync(
            jsonPath,
            "utf8"
          )
        )
      : [];
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      [
        ...previous,
        ...results,
      ],
      null,
      2
    )
  );

  const csvPath =
    `ablation_${CONFIG.testType}_results.csv`;
  const header =
    "test_type,round_tag,seed,attack_ratio,total,tampered_count," +
    "method,accuracy,precision,recall,f1\n";
  const rows = [];
  for (const r of results) {
    for (
      const [
        method,
        m,
      ]
      of [
        [
          "contentOnly",
          r.contentOnly,
        ],
        [
          "twoStage",
          r.twoStage,
        ],
      ]
    ) {
      rows.push(
        [
          r.testType,
          r.roundTag,
          r.seed,
          r.attackRatio,
          r.total,
          r.tamperedCount,
          method,
          metric(m.accuracy),
          metric(m.precision),
          metric(m.recall),
          metric(m.f1),
        ].join(",")
      );
    }
  }

  const exists =
    fs.existsSync(
      csvPath
    );
  fs.appendFileSync(
    csvPath,
    (
      exists
        ? ""
        : header
    ) +
    rows.join("\n") +
    "\n"
  );
  console.log(
    `\nSaved: ${jsonPath}`
  );
  console.log(
    `Saved: ${csvPath}`
  );
  console.log(
    `Next START_ROUND=${currentRound}`
  );
}

main().catch(
  (err) => {
    console.error(
      "\nEXPERIMENT ABORTED"
    );
    console.error(err);
    process.exit(1);
  }
);
