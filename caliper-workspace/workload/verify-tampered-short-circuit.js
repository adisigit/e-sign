const axios = require("axios");

// ============ CONFIG ============
const CONFIG = {
  apiUrl: "http://localhost:3000",
  orgName: "org1",

  authToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiY2VrIiwiZW1haWwiOiJjZWtAc2luZGlrYS5jby5pZCIsInByZWZlcnJlZF91c2VybmFtZSI6ImNlayIsInVzZXJfaWQiOiJrc2FkaGthc2RqIiwicm9sZSI6ImVtcGxveWVlIiwiaWF0IjoxNzg0MzMxNDMxLCJleHAiOjE3ODQzMzUwMzF9.2QWYbLkYezGr_xzvmtq656Os0PEMbVsks2ELDZrNcWI",

  totalRequests: 100,
  concurrency: 10,

  workerIndex: 0,
  roundIndex: 4,

  mode: "one-layer", // "one-layer" | "two-layer"
};

const ENDPOINTS = {
  "one-layer": `${CONFIG.apiUrl}/api/document/webhook/${CONFIG.orgName}/integrity`,
  "two-layer": `${CONFIG.apiUrl}/api/document/${CONFIG.orgName}/integrity-short-circuit`,
};

// ============ GROUND TRUTH ============
// 👉 tentukan docID mana yang memang kamu tamper
const tamperedDocIDs = new Set([
  "DOC-0-4-5",
  "DOC-0-4-12",
  "DOC-0-4-25",
  "DOC-0-4-41",
  "DOC-0-4-77",
]);

// ============ METRICS ============
const metrics = {
  total: 0,
  TP: 0,
  TN: 0,
  FP: 0,
  FN: 0,
  latencies: [],
  shortCircuitCount: 0, // how many requests short-circuited at Layer 1
};

// ============ REQUEST ============
async function verifyRequest(index) {
  const base = CONFIG.workerIndex * 10000;
  const counter = base + index + 1;

  const documentID = `DOC-${CONFIG.workerIndex}-${CONFIG.roundIndex}-${counter}`;

  const content = `Document content`;
  const fileBase64 = Buffer.from(content).toString("base64");

  const start = Date.now();

  try {
    const res = await axios.post(
      ENDPOINTS[CONFIG.mode],
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
      },
    );

    // Prefer server-reported elapsed time (_meta.elapsedMs) when available,
    // since it excludes client-side network/HTTP overhead. Fall back to
    // wall-clock measurement otherwise.
    const data = res.data;
    const latency =
      typeof data?._meta?.elapsedMs === "number"
        ? data._meta.elapsedMs
        : Date.now() - start;
    metrics.latencies.push(latency);

    // =============================
    // 🔥 DETECTION LOGIC
    // =============================
    let detectedValid;

    if (CONFIG.mode === "one-layer") {
      // Simulate single-layer scheme: only look at content-hash agreement,
      // ignore whether the PDC/metadata record itself was tampered with.
      detectedValid = data?.isDocumentValid == true;
    } else {
      // Dual-layer: status is only "INTACT" if both Layer 1 and Layer 2 pass.
      detectedValid = data?.status === "INTACT";

      if (data?._meta?.shortCircuited) {
        metrics.shortCircuitCount++;
      }
    }

    const detectedTampered = !detectedValid;

    // =============================
    // 🔥 GROUND TRUTH
    // =============================
    const actualTampered = tamperedDocIDs.has(documentID);

    // =============================
    // 🔥 CONFUSION MATRIX
    // =============================
    if (actualTampered && detectedTampered) {
      metrics.TP++;
    } else if (!actualTampered && !detectedTampered) {
      metrics.TN++;
    } else if (actualTampered && !detectedTampered) {
      metrics.FN++; // missed detection — berbahaya
      console.warn(
        `⚠️ FN (Missed Tamper): ${documentID} status=${data?.status}`,
      );
    } else if (!actualTampered && detectedTampered) {
      metrics.FP++; // false alarm
      console.warn(
        `⚠️ FP (False Alarm): ${documentID} status=${data?.status}`,
      );
    }
  } catch (err) {
    console.error(`❌ ${documentID}: ${err.message}`);
  } finally {
    metrics.total++;
  }
}

// ============ RUNNER ============
async function runTest() {
  console.log(`\n🚀 START TEST (${CONFIG.mode.toUpperCase()})\n`);
  console.log(`Endpoint: ${ENDPOINTS[CONFIG.mode]}\n`);

  const queue = [];

  for (let i = 0; i < CONFIG.totalRequests; i++) {
    const p = verifyRequest(i);
    queue.push(p);

    p.finally(() => {
      queue.splice(queue.indexOf(p), 1);
    });

    if (queue.length >= CONFIG.concurrency) {
      await Promise.race(queue);
    }
  }

  await Promise.all(queue);

  report();
}

// ============ REPORT ============
function report() {
  const { TP, TN, FP, FN, total, shortCircuitCount } = metrics;

  const accuracy = (TP + TN) / (total || 1);
  const precision = TP / (TP + FP || 1);
  const recall = TP / (TP + FN || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);

  const avgLatency =
    metrics.latencies.reduce((a, b) => a + b, 0) /
    (metrics.latencies.length || 1);

  console.log("\n📊 FINAL REPORT");
  console.log("=".repeat(50));

  console.log(`Mode:        ${CONFIG.mode}`);
  console.log(`Total:       ${total}`);

  console.log("\n--- Confusion Matrix ---");
  console.log(`TP: ${TP}`);
  console.log(`TN: ${TN}`);
  console.log(`FP: ${FP}`);
  console.log(`FN: ${FN}`);

  console.log("\n--- Metrics ---");
  console.log(`Accuracy : ${(accuracy * 100).toFixed(2)}%`);
  console.log(`Precision: ${(precision * 100).toFixed(2)}%`);
  console.log(`Recall   : ${(recall * 100).toFixed(2)}%`);
  console.log(`F1 Score : ${(f1 * 100).toFixed(2)}%`);

  console.log(`\nAvg Latency: ${avgLatency.toFixed(2)} ms`);

  if (CONFIG.mode === "two-layer") {
    console.log(
      `Short-circuited (Layer 1 failed): ${shortCircuitCount}/${total}`,
    );
  }

  console.log("=".repeat(50));
}

// ============ START ============
if (!CONFIG.authToken) {
  console.error(
    "❌ Missing auth token. Set it via: API_AUTH_TOKEN=xxx node ablation_test.js",
  );
  process.exit(1);
}

runTest();
