const axios = require("axios");
const fs = require("fs");

// ============================================================
// CONFIG
// ============================================================
//   API_AUTH_TOKEN=xxxx node workload/verify-tampered-short-curcuit.js verify-batch --label=100tps
//   API_AUTH_TOKEN=xxxx node workload/verify-tampered-short-curcuit.js ablation
const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  workerIndex: Number(process.env.WORKER_INDEX || 0),
  mode: "two-layer", // "one-layer" | "two-layer"

  // ---- verify-batch: run alongside a Caliper register() round ----
  // This does NOT generate the register() load itself -- Caliper does that
  // (see caliper-benchmark-config.yaml). This only fires verify() calls
  // during whatever background load Caliper is currently driving, and
  // records their latency/accuracy at that load level.
  verifyBatch: {
    requests: 100,
    concurrency: 10,
    // PROBE-<workerIndex>-<documentRound>-<counter>, matches the naming
    // convention used in the Caliper workload module. One unique docID
    // per request -- each probe is hit exactly once per TPS level, so
    // there is no repeated-key access within a single verify-batch run
    // that could bias latency via state-database caching.
    probeDocIDs: Array.from({ length: 100 }, (_, i) => `PROBE-0-1-${i + 1}`),
  },

  // ---- ablation replication ----
  ablation: {
    replications: 5,
    docsPerRun: 100,
    // roundIndex -> Set of tampered docIDs for that specific run.
    // Fill this in per replication once you know which docIDs were
    // actually tampered server-side for that round.
    tamperedDocIDsByRound: {
      0: new Set(["DOCUMENT-0-0-5", "DOCUMENT-0-0-12", "DOCUMENT-0-0-25", "DOCUMENT-0-0-41", "DOCUMENT-0-0-77"]),
      1: new Set(["DOCUMENT-0-1-3",  "DOCUMENT-0-1-19", "DOCUMENT-0-1-34", "DOCUMENT-0-1-58", "DOCUMENT-0-1-90"]),
      2: new Set(["DOCUMENT-0-2-8",  "DOCUMENT-0-2-22", "DOCUMENT-0-2-47", "DOCUMENT-0-2-63", "DOCUMENT-0-2-81"]),
      3: new Set(["DOCUMENT-0-3-11", "DOCUMENT-0-3-29", "DOCUMENT-0-3-50", "DOCUMENT-0-3-66", "DOCUMENT-0-3-95"]),
      4: new Set(["DOCUMENT-0-4-5",  "DOCUMENT-0-4-12", "DOCUMENT-0-4-25", "DOCUMENT-0-4-41", "DOCUMENT-0-4-77"]),
    },
  },
};

const ENDPOINTS = {
  "one-layer": `${CONFIG.apiUrl}/api/document/webhook/${CONFIG.orgName}/integrity`,
  "two-layer": `${CONFIG.apiUrl}/api/document/${CONFIG.orgName}/integrity-short-circuit`,
};

// ============================================================
// STATS HELPERS
// ============================================================
function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(idx, 0), sorted.length - 1)];
}

function summarizeLatencies(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  const m = sorted.reduce((a, b) => a + b, 0) / (n || 1);
  const variance = sorted.reduce((a, b) => a + (b - m) ** 2, 0) / (n || 1);
  return {
    n,
    mean: +m.toFixed(2),
    std: +Math.sqrt(variance).toFixed(2),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? NaN,
    max: sorted[n - 1] ?? NaN,
  };
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
}
function std(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

// ============================================================
// SINGLE REQUEST (shared)
// ============================================================
async function sendVerify(documentID) {
  const content = `Document content`;
  const fileBase64 = Buffer.from(content).toString("base64");
  const start = Date.now();

  try {
    const res = await axios.post(
      ENDPOINTS[CONFIG.mode],
      { id: documentID, file: fileBase64 },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.authToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    );

    const data = res.data;
    const latency =
      typeof data?._meta?.elapsedMs === "number"
        ? data._meta.elapsedMs
        : Date.now() - start;

    return { ok: true, documentID, data, latency };
  } catch (err) {
    return { ok: false, documentID, error: err.message, latency: Date.now() - start };
  }
}

// ============================================================
// VERIFY-BATCH: fires N verify() calls with bounded concurrency.
// Intended to run WHILE a Caliper round is driving register() load.
// Run this once per Caliper round with a matching --label.
// ============================================================
async function runVerifyBatch(label) {
  const { requests, concurrency, probeDocIDs } = CONFIG.verifyBatch;
  console.log(`\n🚀 VERIFY BATCH  label=${label}  mode=${CONFIG.mode}  n=${requests}\n`);
  console.log(`Cycling through ${probeDocIDs.length} probe docIDs: ${probeDocIDs.join(", ")}\n`);

  const results = [];
  const queue = [];

  for (let i = 0; i < requests; i++) {
    // round-robin through the fixed, pre-registered, never-tampered probes
    const documentID = probeDocIDs[i % probeDocIDs.length];
    const p = sendVerify(documentID).then((r) => results.push(r));
    queue.push(p);
    p.finally(() => queue.splice(queue.indexOf(p), 1));
    if (queue.length >= concurrency) await Promise.race(queue);
  }
  await Promise.all(queue);

  const successes = results.filter((r) => r.ok);
  const stats = summarizeLatencies(successes.map((r) => r.latency));

  console.log({
    label,
    requestsIssued: results.length,
    requestsFailed: results.length - successes.length,
    ...stats,
  });

  const row = `${label},${stats.n},${stats.mean},${stats.std},${stats.p50},${stats.p95},${stats.p99},${stats.min},${stats.max},${results.length - successes.length}\n`;
  const file = "verify_batch_results.csv";
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "label,n,mean_ms,std_ms,p50_ms,p95_ms,p99_ms,min_ms,max_ms,failed\n");
  }
  fs.appendFileSync(file, row);
  console.log(`\n✅ Appended to ${file} -- run this once per Caliper round (10/25/50/100 tps)`);
}


// ============================================================
// ABLATION WITH REPLICATION (unchanged from before)
// ============================================================
async function runAblationRound(roundIndex, tamperedDocIDs, docsPerRun) {
  const metrics = { TP: 0, TN: 0, FP: 0, FN: 0, total: 0, shortCircuitCount: 0, latencies: [] };

  for (let i = 0; i < docsPerRun; i++) {
    const documentID = `DOCUMENT-${CONFIG.workerIndex}-${roundIndex}-${i + 1}`;
    const r = await sendVerify(documentID);
    if (!r.ok) continue;

    metrics.total++;
    metrics.latencies.push(r.latency);

    let detectedValid;
    if (CONFIG.mode === "one-layer") {
      detectedValid = r.data?.isDocumentValid == true;
    } else {
      detectedValid = r.data?.status === "INTACT";
      if (r.data?._meta?.shortCircuited) metrics.shortCircuitCount++;
    }

    const detectedTampered = !detectedValid;
    const actualTampered = tamperedDocIDs.has(documentID);

    if (actualTampered && detectedTampered) metrics.TP++;
    else if (!actualTampered && !detectedTampered) metrics.TN++;
    else if (actualTampered && !detectedTampered) metrics.FN++;
    else metrics.FP++;
  }

  const { TP, TN, FP, FN, total } = metrics;
  const accuracy = (TP + TN) / (total || 1);
  const precision = TP / (TP + FP || 1);
  const recall = TP / (TP + FN || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);

  return { roundIndex, ...metrics, accuracy, precision, recall, f1 };
}

async function runAblationSweep() {
  console.log(`\n🚀 ABLATION WITH REPLICATION (mode=${CONFIG.mode})\n`);
  const { replications, docsPerRun, tamperedDocIDsByRound } = CONFIG.ablation;
  const rounds = [];

  for (let roundIndex = 0; roundIndex < replications; roundIndex++) {
    const tamperedDocIDs = tamperedDocIDsByRound[roundIndex];
    if (!tamperedDocIDs) {
      console.warn(`⚠️ No ground truth defined for round ${roundIndex}, skipping.`);
      continue;
    }
    console.log(`--- Round ${roundIndex} ---`);
    const round = await runAblationRound(roundIndex, tamperedDocIDs, docsPerRun);
    console.log(round);
    rounds.push(round);
  }

  const accs = rounds.map((r) => r.accuracy * 100);
  const precs = rounds.map((r) => r.precision * 100);
  const recs = rounds.map((r) => r.recall * 100);
  const f1s = rounds.map((r) => r.f1 * 100);

  console.log("\n📊 AGGREGATE ACROSS ROUNDS (mean ± std)");
  console.log(`Accuracy : ${mean(accs).toFixed(2)}% ± ${std(accs).toFixed(2)}%`);
  console.log(`Precision: ${mean(precs).toFixed(2)}% ± ${std(precs).toFixed(2)}%`);
  console.log(`Recall   : ${mean(recs).toFixed(2)}% ± ${std(recs).toFixed(2)}%`);
  console.log(`F1 Score : ${mean(f1s).toFixed(2)}% ± ${std(f1s).toFixed(2)}%`);

  const csvHeader = "round,total,TP,TN,FP,FN,accuracy,precision,recall,f1,short_circuit_count\n";
  const csvBody = rounds
    .map(
      (r) =>
        `${r.roundIndex},${r.total},${r.TP},${r.TN},${r.FP},${r.FN},${(r.accuracy * 100).toFixed(2)},${(r.precision * 100).toFixed(2)},${(r.recall * 100).toFixed(2)},${(r.f1 * 100).toFixed(2)},${r.shortCircuitCount}`,
    )
    .join("\n");
  fs.writeFileSync("ablation_replication_results.csv", csvHeader + csvBody);
  console.log("\n✅ Saved: ablation_replication_results.csv (report mean ± std in the paper, not a single run)");
}

// ============================================================
// ENTRYPOINT
// ============================================================
if (!CONFIG.authToken) {
  console.error("❌ Missing auth token. Run with: API_AUTH_TOKEN=xxx node extended_evaluation.js <verify-batch|ablation>");
  process.exit(1);
}

const testType = process.argv[2];
const labelArg = process.argv.find((a) => a.startsWith("--label="));
const label = labelArg ? labelArg.split("=")[1] : "unlabeled";

if (testType === "verify-batch") {
  runVerifyBatch(label);
} else if (testType === "ablation") {
  runAblationSweep();
} else {
  console.error("Usage:");
  console.error("  node extended_evaluation.js verify-batch --label=25tps   (run once per Caliper round)");
  console.error("  node extended_evaluation.js ablation");
  process.exit(1);
}
