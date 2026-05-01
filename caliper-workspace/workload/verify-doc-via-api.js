const axios = require("axios");

// ============ CONFIG ============
const CONFIG = {
  apiUrl: "http://localhost:3000",
  orgName: "org1",
  authToken:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiY2VrIiwiZW1haWwiOiJjZWtAc2luZGlrYS5jby5pZCIsInByZWZlcnJlZF91c2VybmFtZSI6ImNlayIsInVzZXJfaWQiOiJqYXNkamFzZCIsInJvbGUiOiJrYXJ5YXdhbiIsImlhdCI6MTc3Njk5NjE1MiwiZXhwIjoxNzc2OTk5NzUyfQ.s9g_Le0U0FcXza1844gjl6xoJetyKDAawIzMOyrjvZ8",

  totalRequests: 100,
  concurrency: 10,

  workerIndex: 0,
  roundIndex: 4,
};

// ============ METRICS ============
const metrics = {
  total: 0,
  success: 0,
  failed: 0,
  latencies: [],
};

// ============ REQUEST ============
async function verifyRequest(index) {
  const base = CONFIG.workerIndex * 10000;
  const counter = base + index + 1;

  const content = `Document content`;
  const fileBase64 = Buffer.from(content).toString("base64");

  const documentID = `DOC-${CONFIG.workerIndex}-${CONFIG.roundIndex}-${counter}`;

  const start = Date.now();

  try {
    const res = await axios.post(
      `${CONFIG.apiUrl}/api/document/webhook/${CONFIG.orgName}/integrity`,
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

    const latency = Date.now() - start;
    metrics.latencies.push(latency);

    const data = res.data;

    const isValid = data?.isDocumentValid === true ||data?.integrityStatus === true ||data?.status === "VALID";

    if (isValid) {
      metrics.success++;
    } else {
      metrics.failed++;
      console.warn(`⚠️ Integrity FAIL: ${documentID}`);
    }
  } catch (err) {
    metrics.failed++;
    console.error(`❌ ${documentID}: ${err.message}`);
  } finally {
    metrics.total++;
  }
}

// ============ RUNNER ============
async function runTest() {
  console.log("\n🚀 START VERIFY TEST (POST MODE)\n");

  const queue = [];

  for (let i = 0; i < CONFIG.totalRequests; i++) {
    const p = verifyRequest(i);
    queue.push(p);

    // concurrency control yang benar
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
  const successRate = ((metrics.success / metrics.total) * 100).toFixed(2);

  const avgLatency =
    metrics.latencies.reduce((a, b) => a + b, 0) /
    (metrics.latencies.length || 1);

  console.log("\n📊 VERIFY REPORT");
  console.log("=".repeat(40));
  console.log(`Total:        ${metrics.total}`);
  console.log(`Success:      ${metrics.success}`);
  console.log(`Failed:       ${metrics.failed}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Avg Latency:  ${avgLatency.toFixed(2)} ms`);
  console.log("=".repeat(40));
}

// ============ START ============
runTest();
