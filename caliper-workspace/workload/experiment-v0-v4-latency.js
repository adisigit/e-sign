"use strict";

const axios = require("axios");
const fs = require("fs");

const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  docs: Number(process.env.DOCS || 100),
  repetitions: Number(process.env.REPETITIONS || 5),
  warmupPerVariant: Number(process.env.WARMUP_PER_VARIANT || 20),
  seed: Number(process.env.SEED || 43),
  documentPrefix: process.env.DOCUMENT_PREFIX || "DOCS-0-160-",
  registeredContent: process.env.REGISTERED_CONTENT || "Document content",
  outputPath: process.env.OUTPUT_PATH || "v0-v4-e2e-latency.jsonl",
};

if (!CONFIG.authToken) throw new Error("Missing API_AUTH_TOKEN");

const VARIANTS = ["V0", "V1", "V2", "V3", "V4"];

const EXPECTED_STATUS = {
  V0: "CONTENT_INTACT",
  V1: "RAW_RECORD_INTACT",
  V2: "CANONICAL_RECORD_INTACT",
  V3: "RECORD_INTACT",
  V4: "INTACT",
};

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng) {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function buildDocumentIDs() {
  return Array.from(
    { length: CONFIG.docs },
    (_, index) => `${CONFIG.documentPrefix}${index + 1}`
  );
}

function buildTasks(documentIDs) {
  const tasks = [];

  for (const documentID of documentIDs) {
    for (const variant of VARIANTS) {
      tasks.push({ documentID, variant });
    }
  }

  return tasks;
}

async function verify(documentID, variant) {
  const endpoint =
    `${CONFIG.apiUrl}/api/document/verify-ablation/` +
    `${CONFIG.orgName}/ablate/${variant}`;

  const file = Buffer.from(CONFIG.registeredContent).toString("base64");
  const startedAt = process.hrtime.bigint();

  try {
    const response = await axios.post(
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
      elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      data: response.data,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      error: error.response?.data || error.message,
    };
  }
}

function assertClean(result, documentID, variant, context) {
  if (!result.ok) {
    throw new Error(
      `${context}: request failed variant=${variant}, doc=${documentID}: ` +
      JSON.stringify(result.error)
    );
  }

  const status = result.data?.status;
  const detected = result.data?.detected;

  if (status !== EXPECTED_STATUS[variant] || detected !== false) {
    throw new Error(
      `${context}: dirty state variant=${variant}, doc=${documentID}, ` +
      `expected=${EXPECTED_STATUS[variant]}, actual=${status}, detected=${detected}`
    );
  }
}

async function warmup(documentIDs) {
  console.log("\n=== WARM-UP ===");

  for (const variant of VARIANTS) {
    for (let i = 0; i < CONFIG.warmupPerVariant; i++) {
      const documentID = documentIDs[i % documentIDs.length];
      const result = await verify(documentID, variant);

      assertClean(
        result,
        documentID,
        variant,
        "warm-up"
      );
    }

    console.log(`${variant}: ${CONFIG.warmupPerVariant} calls OK`);
  }
}

async function runExperiment() {
  const documentIDs = buildDocumentIDs();
  const baseTasks = buildTasks(documentIDs);

  console.log("\n=== V0-V4 E2E LATENCY EXPERIMENT ===");
  console.log(`Documents         : ${documentIDs.length}`);
  console.log(`Variants          : ${VARIANTS.join(", ")}`);
  console.log(`Repetitions       : ${CONFIG.repetitions}`);
  console.log(`Warm-up/variant   : ${CONFIG.warmupPerVariant}`);
  console.log(`Seed              : ${CONFIG.seed}`);
  console.log(`Document prefix   : ${CONFIG.documentPrefix}`);
  console.log(`Calls/repetition  : ${baseTasks.length}`);
  console.log(`Measurement calls : ${baseTasks.length * CONFIG.repetitions}`);

  await warmup(documentIDs);

  fs.writeFileSync(CONFIG.outputPath, "");

  for (let repetition = 1; repetition <= CONFIG.repetitions; repetition++) {
    const repetitionSeed = CONFIG.seed + repetition;
    const rng = mulberry32(repetitionSeed);
    const tasks = shuffle(baseTasks, rng);

    console.log(
      `\n=== REPETITION ${repetition}/${CONFIG.repetitions} ` +
      `(seed=${repetitionSeed}) ===`
    );

    let completed = 0;

    for (const task of tasks) {
      const { documentID, variant } = task;
      const result = await verify(documentID, variant);

      assertClean(
        result,
        documentID,
        variant,
        `repetition=${repetition}`
      );

      const row = {
        repetition,
        seed: repetitionSeed,
        variant,
        documentID,
        latencyMs: result.elapsedMs,
        queryElapsedMs: result.data?._meta?.queryElapsedMs ?? null,
        totalElapsedMs: result.data?._meta?.totalElapsedMs ?? null,
        status: result.data?.status,
      };

      fs.appendFileSync(
        CONFIG.outputPath,
        JSON.stringify(row) + "\n"
      );

      completed++;

      if (completed % 100 === 0 || completed === tasks.length) {
        console.log(`Progress: ${completed}/${tasks.length}`);
      }
    }
  }

  console.log("\nExperiment completed.");
  console.log(`Saved: ${CONFIG.outputPath}`);
}

runExperiment().catch((error) => {
  console.error("\nEXPERIMENT FAILED");
  console.error(error);
  process.exit(1);
});
