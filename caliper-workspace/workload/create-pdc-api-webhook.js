const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");

// ============ KONFIGURASI ============
const CONFIG = {
  apiUrl: "http://localhost:3000",
  orgName: "org2",
  tps: 10, // 10 / 50 / 100
  durationSec: 10,
  sentDocsFile: "sent-webhooks.json",
  failedDocsFile: "failed-webhooks.json",
  reportFile: "webhook-report.json",
};

// Sample categories
const CATEGORIES = [
  "CONTRACT",
  "INVOICE",
  "AGREEMENT",
  "REPORT",
  "POLICY",
  "LAINNYA",
];

// Sample recipients generator
function generateRecipients() {
  const recipientCount = Math.floor(Math.random() * 3) + 1; // 1-3 recipients
  const recipients = [];
  for (let i = 0; i < recipientCount; i++) {
    recipients.push({
      recipientId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      name: `User ${Math.floor(Math.random() * 50)}`,
      recipientRoleCode: "signer",
      userRoleCode: "karyawan",
      signingOrder: i + 1,
    });
  }
  return recipients;
}

// ============ METRICS ============
const metrics = {
  total: 0,
  success: 0,
  failed: 0,
  latencies: [],
  errors: [],
  sentDocs: [],
  failedDocs: [],
  startTime: null,
  endTime: null,
};

// ============ HELPER ============
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ MAIN REQUEST FUNCTION ============
async function sendWebhookRequest(index) {
  const documentID = `${crypto.randomUUID()}-${CONFIG.orgName}`;
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const fileContent = `Document content ${documentID}`;
  const fileHash = crypto
    .createHash("sha256")
    .update(fileContent)
    .digest("hex");
  const recipients = generateRecipients();

  const payload = {
    id: documentID,
    documentCategoryCode: category,
    name: `Webhook Document ${index}`,
    description: `Performance test document - ${category}`,
    file: fileHash,
    recipients,
    userId: "admin",
  };

  const startTime = Date.now();
  try {
    const response = await axios.post(
      `${CONFIG.apiUrl}/api/webhook/${CONFIG.orgName}`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const latency = Date.now() - startTime;
    metrics.success++;
    metrics.latencies.push(latency);
    metrics.sentDocs.push({
      documentID,
      category,
      latency,
      timestamp: new Date().toISOString(),
    });
    return { success: true, documentID, latency };
  } catch (error) {
    const latency = Date.now() - startTime;
    metrics.failed++;
    metrics.errors.push({
      documentID,
      error: error.message,
      status: error.response?.status,
      timestamp: new Date().toISOString(),
    });
    metrics.failedDocs.push({ documentID, error: error.message });
    return { success: false, documentID, error: error.message };
  } finally {
    metrics.total++;
  }
}

// ============ CONCURRENCY EXECUTOR ============
async function runLoadTest() {
  const intervalMs = 1000 / CONFIG.tps;
  const totalRequests = CONFIG.tps * CONFIG.durationSec;

  console.log(
    `🚀 API Fixed-Rate Benchmark: ${CONFIG.tps} TPS for ${CONFIG.durationSec}s ` +
    `(${totalRequests} requests)`
  );

  metrics.startTime = Date.now();

  const inFlight = [];

  for (let i = 0; i < totalRequests; i++) {
    const p = sendWebhookRequest(i);
    inFlight.push(p);

    await sleep(intervalMs);
  }

  await Promise.all(inFlight);

  metrics.endTime = Date.now();
}

// ============ REPORT ============
function generateReport() {
  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const successRate = ((metrics.success / metrics.total) * 100).toFixed(2);

  const sortedLatencies = metrics.latencies.sort((a, b) => a - b);
  const avgLatency =
    sortedLatencies.length > 0
      ? (
          sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
        ).toFixed(2)
      : 0;

  const report = {
    summary: {
      totalRequests: metrics.total,
      successful: metrics.success,
      failed: metrics.failed,
      successRate: `${successRate}%`,
      duration: `${duration.toFixed(2)}s`,
      throughput: `${(metrics.total / duration).toFixed(2)} req/s`,
    },
    latency: {
      avg: `${avgLatency}ms`,
      min: `${sortedLatencies[0] || 0}ms`,
      max: `${sortedLatencies[sortedLatencies.length - 1] || 0}ms`,
      p50: `${
        sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0
      }ms`,
      p95: `${
        sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0
      }ms`,
      p99: `${
        sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0
      }ms`,
    },
    errors: metrics.errors.slice(0, 10),
  };

  fs.writeFileSync(
    CONFIG.sentDocsFile,
    JSON.stringify(metrics.sentDocs, null, 2)
  );
  fs.writeFileSync(
    CONFIG.failedDocsFile,
    JSON.stringify(metrics.failedDocs, null, 2)
  );
  fs.writeFileSync(CONFIG.reportFile, JSON.stringify(report, null, 2));

  console.log(`✅ Test completed: Success rate ${successRate}%`);
  return report;
}

// ============ MAIN ============
async function main() {
  try {
    await runLoadTest();
    generateReport();
  } catch (error) {
    console.error("❌ Load test failed:", error.message);
  }
}

main();
