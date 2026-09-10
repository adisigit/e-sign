"use strict";

const axios = require("axios");
const fs = require("fs");

const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  documentPrefix: process.env.DOCUMENT_PREFIX || "DOCS-0-160-",
  docs: Number(process.env.DOCS || 100),
  requestsPerLevel: Number(process.env.REQUESTS || 500),
  cooldownMs: Number(process.env.COOLDOWN_MS || 2000),
  variant: process.env.VARIANT || "V4",
};

if (!CONFIG.authToken) throw new Error("Missing API_AUTH_TOKEN");

const CONCURRENCY_LEVELS = (
  process.env.CONCURRENCY_LEVELS || "1,5,10,25,50,100"
)
  .split(",")
  .map(Number);

const REGISTERED_CONTENT = "Document content";
const FILE_BASE64 = Buffer.from(REGISTERED_CONTENT).toString("base64");

const CLEAN_STATUS = {
  V0: "CONTENT_INTACT",
  V1: "RAW_RECORD_INTACT",
  V2: "CANONICAL_RECORD_INTACT",
  V3: "RECORD_INTACT",
  V4: "INTACT",
};

if (!CLEAN_STATUS[CONFIG.variant]) {
  throw new Error(`Unsupported variant: ${CONFIG.variant}`);
}

function documentID(index) {
  return `${CONFIG.documentPrefix}${(index % CONFIG.docs) + 1}`;
}

async function sendVerify(documentID) {
  const endpoint =
    `${CONFIG.apiUrl}/api/document/verify-ablation/` +
    `${CONFIG.orgName}/ablate/${CONFIG.variant}`;

  const startedAt = process.hrtime.bigint();

  try {
    const res = await axios.post(
      endpoint,
      {
        id: documentID,
        file: FILE_BASE64,
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.authToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    return {
      ok:
        res.data?.status === CLEAN_STATUS[CONFIG.variant] &&
        res.data?.detected === false,
      status: res.data?.status,
      detected: res.data?.detected,
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

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.ceil((p / 100) * sorted.length) - 1
  );

  return sorted[index];
}

async function runLevel(concurrency) {
  console.log(`\n=== CONCURRENCY ${concurrency} ===`);

  const results = [];
  let nextIndex = 0;

  const startedAt = process.hrtime.bigint();

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= CONFIG.requestsPerLevel) return;

      const result = await sendVerify(
        documentID(index)
      );

      results.push(result);
    }
  }

  await Promise.all(
    Array.from(
      { length: concurrency },
      () => worker()
    )
  );

  const durationSeconds =
    Number(process.hrtime.bigint() - startedAt) / 1e9;

  const successes = results.filter((row) => row.ok);
  const failures = results.filter((row) => !row.ok);
  const latencies = successes.map((row) => row.latencyMs);

  const result = {
    concurrency,
    requests: results.length,
    success: successes.length,
    failures: failures.length,
    meanMs: mean(latencies),
    medianMs: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    minMs: latencies.length > 0 ? Math.min(...latencies) : null,
    maxMs: latencies.length > 0 ? Math.max(...latencies) : null,
    durationSeconds,
    throughputRps: results.length / durationSeconds,
  };

  console.log(
    `requests=${result.requests} ` +
    `success=${result.success} ` +
    `failures=${result.failures} ` +
    `mean=${result.meanMs?.toFixed(2)}ms ` +
    `p50=${result.medianMs?.toFixed(2)}ms ` +
    `p95=${result.p95Ms?.toFixed(2)}ms ` +
    `p99=${result.p99Ms?.toFixed(2)}ms ` +
    `throughput=${result.throughputRps.toFixed(2)} req/s`
  );

  return result;
}

async function main() {
  const results = [];
  console.log(`Testing variant ${CONFIG.variant}...`);
  console.log("Warm-up...");

  for (let i = 0; i < 20; i++) {
    const result = await sendVerify(documentID(i));

    if (!result.ok) {
      throw new Error(
        `Warm-up failed for ${documentID(i)}: ${result.status || result.error}`
      );
    }
  }

  console.log("Warm-up complete.");

  for (const concurrency of CONCURRENCY_LEVELS) {
    results.push(
      await runLevel(concurrency)
    );

    await new Promise(
      (resolve) => setTimeout(resolve, CONFIG.cooldownMs)
    );
  }

  const jsonPath = `scalability_results_${CONFIG.variant}.json`;
  const csvPath = `scalability_results_${CONFIG.variant}.csv`;

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(results, null, 2)
  );

  const header = [
    "concurrency",
    "requests",
    "success",
    "failures",
    "mean_ms",
    "median_ms",
    "p95_ms",
    "p99_ms",
    "min_ms",
    "max_ms",
    "duration_seconds",
    "throughput_rps",
  ].join(",");

  const rows = results.map((row) => [
    row.concurrency,
    row.requests,
    row.success,
    row.failures,
    row.meanMs,
    row.medianMs,
    row.p95Ms,
    row.p99Ms,
    row.minMs,
    row.maxMs,
    row.durationSeconds,
    row.throughputRps,
  ].join(","));

  fs.writeFileSync(
    csvPath,
    header + "\n" + rows.join("\n") + "\n"
  );

  console.log(`\nSaved: ${jsonPath}`);
  console.log(`Saved: ${csvPath}`);
}

main().catch((err) => {
  console.error("\nSCALABILITY TEST FAILED");
  console.error(err);
  process.exit(1);
});
