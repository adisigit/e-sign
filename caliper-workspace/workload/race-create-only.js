"use strict";
// ============================================================
// race-create-only.js  (Test #2)
//
// Fires N register() requests for the SAME docID, truly concurrently
// (no await between dispatches), then polls each to its terminal
// status. Confirms the create-only guarantee holds not just under
// sequential re-registration (SC-06) but under concurrent submission,
// where the guarantee could in principle depend on Fabric's MVCC
// version-checking at commit time rather than only the application-
// level ensureDocumentDoesNotExist precondition.
//
// USAGE:
//   API_AUTH_TOKEN=xxx node race-create-only.js <N> <docID>
//   API_AUTH_TOKEN=xxx node race-create-only.js 50 RACE-TEST-A
// ============================================================

const axios = require("axios");
const fs = require("fs");

const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  collection: process.env.COLLECTION || "collectionOrg1",
};

if (!CONFIG.authToken) {
  console.error("❌ Missing API_AUTH_TOKEN");
  process.exit(1);
}

// Adjust this path to match your actual register() route.
const REGISTER_ENDPOINT = `${CONFIG.apiUrl}/api/webhook/${CONFIG.orgName}`;

async function sendRegister(documentID, attemptTag) {
  const content = `Document content`;
  const fileBase64 = Buffer.from(content).toString("base64");
  const start = Date.now();
  try {
    const res = await axios.post(
      REGISTER_ENDPOINT,
      {
        collection: CONFIG.collection,
        id: documentID,
        documentCategoryCode: "CONTRACT",
        name: `Race test doc`,
        description: `Race attempt ${attemptTag}`,
        file: fileBase64,
        recipients: [
          { userId: "USER-1", name: "Tester", userRoleCode: "VIEWER", recipientRoleCode: "SIGNER" },
        ],
      },
      {
        headers: { Authorization: `Bearer ${CONFIG.authToken}`, "Content-Type": "application/json" },
        timeout: 10000,
      }
    );
    return { ok: true, attemptTag, status: res.status, data: res.data, latency: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      attemptTag,
      status: err.response?.status,
      error: err.response?.data?.message || err.message,
      latency: Date.now() - start,
    };
  }
}

async function pollStatus(statusUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await axios.get(`${CONFIG.apiUrl}${statusUrl}`, {
        headers: { Authorization: `Bearer ${CONFIG.authToken}` },
      });
      const status = res.data?.data?.currentStatus;
      if (["completed", "failed", "dlq"].includes(status)) {
        return { ...res.data.data, status };
      }
    } catch (_) {
      // keep polling; transient errors during processing are expected
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: "timeout" };
}

async function runRaceTest(N, documentID) {
  console.log(`\n🏁 RACE TEST: ${N} concurrent register() calls for docID=${documentID}\n`);

  // Fire all N truly in parallel -- no await between dispatches.
  const attempts = Array.from({ length: N }, (_, i) => sendRegister(documentID, i));
  const results = await Promise.all(attempts);

  const httpAccepted = results.filter((r) => r.ok);
  const httpRejected = results.filter((r) => !r.ok);

  console.log(`HTTP-level: ${httpAccepted.length} queued, ${httpRejected.length} rejected immediately`);
  if (httpRejected.length > 0) {
    console.log(`  Sample rejection reasons: ${[...new Set(httpRejected.map((r) => r.error))].join(" | ")}`);
  }

  const pollTimeoutMs = Math.max(15000, N * 1500);
    console.log(`Using poll timeout: ${pollTimeoutMs}ms for N=${N}`);

    const finalStates = await Promise.all(
      httpAccepted.map((r) =>
        pollStatus(r.data.statusUrl, pollTimeoutMs).then((s) => ({ attemptTag: r.attemptTag, ...s }))
      )
    );

  const committed = finalStates.filter((s) => s.status === "completed");
  const failed = finalStates.filter((s) => s.status === "failed" || s.status === "dlq");
  const timedOut = finalStates.filter((s) => s.status === "timeout");

  const preconditionRejected = failed.filter(
    (s) => s.metadata?.rejectionCause === "PRECONDITION_REJECTED"
  );
  const mvccConflict = failed.filter(
    (s) => s.metadata?.rejectionCause === "MVCC_CONFLICT"
  );
  const unclassified = failed.filter(
    (s) => !["PRECONDITION_REJECTED", "MVCC_CONFLICT"].includes(s.metadata?.rejectionCause)
  );

  const violation = committed.length !== 1;
  if (violation) {
    console.error(`❌ VIOLATION: expected exactly 1 committed registration, got ${committed.length}`);
  } else {
    console.log(`✅ Exactly 1 committed registration, as expected for create-only key`);
  }

  console.log(
    `Rejection breakdown: ${preconditionRejected.length} precondition, ` +
    `${mvccConflict.length} MVCC conflict, ${unclassified.length} unclassified`
  );

  const row = {
    documentID,
    N,
    httpQueued: httpAccepted.length,
    httpRejectedImmediate: httpRejected.length,
    committed: committed.length,
    failedOrDlq: failed.length,
    preconditionRejected: preconditionRejected.length,
    mvccConflict: mvccConflict.length,
    unclassifiedRejection: unclassified.length,
    timeout: timedOut.length,
    violation,
    timestamp: new Date().toISOString(),
  };

  const file = "race_test_results.jsonl";
  fs.appendFileSync(file, JSON.stringify(row) + "\n");
  console.log(`\n✅ Appended to ${file}`);
  console.log(row);

  return row;
}

async function main() {
  const N = Number(process.argv[2] || 20);
  const documentID = process.argv[3] || `RACE-TEST-${Date.now()}`;
  await runRaceTest(N, documentID);
}

main();
