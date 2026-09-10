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
};

if (!CONFIG.authToken) throw new Error("Missing API_AUTH_TOKEN");

const REGISTERED_CONTENT = "Document content";
const TAMPERED_CONTENT = "Document content-MODIFIED";

const RECORD_ATTACKS = [
  "change_permitted_value",
  "change_description",
  "change_category",
  "remove_required_field",
  "add_unknown_field",
  "null_required_field",
  "wrong_document_id_binding",
  "wrong_collection_binding",
  "malformed_timestamp",
  "substitute_document_hash",
  "malformed_hash_length",
];

function allDocumentIDs() {
  return Array.from(
    { length: CONFIG.docsPerRun },
    (_, i) => `${CONFIG.documentPrefix}${i + 1}`
  );
}

async function sendVerify(documentID, useTamperedContent = false) {
  const content = useTamperedContent ? TAMPERED_CONTENT : REGISTERED_CONTENT;
  const file = Buffer.from(content).toString("base64");

  const endpoint =
    `${CONFIG.apiUrl}/api/document/verify-ablation/` +
    `${CONFIG.orgName}/ablate/V4`;

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

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertClean(documentID) {
  const res = await sendVerify(documentID, false);

  assertCondition(res.ok, `V4 request failed for ${documentID}`);
  assertCondition(
    res.data?.status === "INTACT",
    `${documentID} expected INTACT, got ${res.data?.status}`
  );

  return res;
}

async function testContentAttack(documentID) {
  console.log(`\n=== CONTENT ATTACK ${documentID} ===`);

  await assertClean(documentID);

  const res = await sendVerify(documentID, true);

  assertCondition(res.ok, "Content attack verification failed");
  assertCondition(res.data?.detected === true, "Content attack not detected");
  assertCondition(
    res.data?.status === "DOCUMENT_MODIFIED",
    `Expected DOCUMENT_MODIFIED, got ${res.data?.status}`
  );
  assertCondition(res.data?.layer1 === true, "Layer 1 should pass");
  assertCondition(res.data?.layer2 === false, "Layer 2 should fail");

  return {
    attack: "document_content_modified",
    documentID,
    status: res.data.status,
    detected: res.data.detected,
    layer1: res.data.layer1,
    layer2: res.data.layer2,
    latencyMs: res.latencyMs,
    passed: true,
  };
}

async function testRecordAttack(documentID, mutation) {
  console.log(`\n=== RECORD ATTACK ${mutation} ${documentID} ===`);

  await assertClean(documentID);

  const snapshots = await snapshotBatch([documentID]);
  let res;

  try {
    const tamperResult = await tamperBatch([documentID], [mutation]);

    assertCondition(
      tamperResult.some((row) => row.ok),
      `Tampering failed: ${mutation}`
    );

    res = await sendVerify(documentID, false);

    assertCondition(res.ok, `Verification failed: ${mutation}`);
    assertCondition(res.data?.detected === true, `${mutation} not detected`);
    assertCondition(res.data?.layer1 === false, `${mutation} should fail Layer 1`);
    assertCondition(res.data?.layer2 === null, `${mutation} should skip Layer 2`);
    assertCondition(
      res.data?.failedLayer === "layer1_private_record",
      `${mutation} failedLayer unexpected`
    );
  } finally {
    const restoreResult = await restoreBatch(snapshots);
    const restoreFailures = restoreResult.filter((row) => !row.ok);

    if (restoreFailures.length > 0) {
      throw new Error(`Restore failed: ${JSON.stringify(restoreFailures)}`);
    }

    await assertClean(documentID);
  }

  return {
    attack: mutation,
    documentID,
    status: res.data.status,
    detected: res.data.detected,
    layer1: res.data.layer1,
    layer2: res.data.layer2,
    latencyMs: res.latencyMs,
    passed: true,
  };
}

async function testCombinedAttack(documentID) {
  console.log(`\n=== COMBINED ATTACK ${documentID} ===`);

  await assertClean(documentID);

  const snapshots = await snapshotBatch([documentID]);
  let res;

  try {
    const tamperResult = await tamperBatch(
      [documentID],
      ["change_description"]
    );

    assertCondition(
      tamperResult.some((row) => row.ok),
      "Combined record tampering failed"
    );

    res = await sendVerify(documentID, true);

    assertCondition(res.ok, "Combined verification failed");
    assertCondition(res.data?.detected === true, "Combined attack not detected");
    assertCondition(res.data?.layer1 === false, "Combined attack should fail Layer 1");
    assertCondition(res.data?.layer2 === null, "Layer 2 should be skipped");
    assertCondition(
      res.data?.failedLayer === "layer1_private_record",
      "Combined attack should fail at Layer 1 first"
    );
  } finally {
    const restoreResult = await restoreBatch(snapshots);
    const restoreFailures = restoreResult.filter((row) => !row.ok);

    if (restoreFailures.length > 0) {
      throw new Error(`Restore failed: ${JSON.stringify(restoreFailures)}`);
    }

    await assertClean(documentID);
  }

  return {
    attack: "combined_record_and_content",
    documentID,
    status: res.data.status,
    detected: res.data.detected,
    layer1: res.data.layer1,
    layer2: res.data.layer2,
    latencyMs: res.latencyMs,
    passed: true,
  };
}

async function main() {
  const docIDs = allDocumentIDs();
  const results = [];

  results.push(await testContentAttack(docIDs[0]));

  for (let i = 0; i < RECORD_ATTACKS.length; i++) {
    results.push(
      await testRecordAttack(
        docIDs[(i + 1) % docIDs.length],
        RECORD_ATTACKS[i]
      )
    );
  }

  results.push(
    await testCombinedAttack(
      docIDs[(RECORD_ATTACKS.length + 1) % docIDs.length]
    )
  );

  const passed = results.filter((row) => row.passed).length;
  const failed = results.length - passed;

  console.log("\n=== ATTACK COVERAGE RESULT ===");
  console.log(`Total  : ${results.length}`);
  console.log(`Passed : ${passed}`);
  console.log(`Failed : ${failed}`);

  for (const row of results) {
    console.log(
      `${row.passed ? "PASS" : "FAIL"} | ${row.attack} | ${row.status}`
    );
  }

  fs.writeFileSync(
    "attack_coverage_results.json",
    JSON.stringify(results, null, 2)
  );

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\nATTACK COVERAGE TEST FAILED");
  console.error(err);
  process.exit(1);
});
