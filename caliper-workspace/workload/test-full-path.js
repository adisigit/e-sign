"use strict";

const axios = require("axios");
const {
  tamperBatch,
  snapshotBatch,
  restoreBatch,
} = require("./tamper-pdc-record");

const CONFIG = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  orgName: process.env.ORG_NAME || "org1",
  authToken: process.env.API_AUTH_TOKEN,
  documentID: process.env.DOCUMENT_ID || "DOCS-0-160-1",
};

if (!CONFIG.authToken) throw new Error("Missing API_AUTH_TOKEN");

const VARIANTS = ["V0", "V1", "V2", "V3", "V4"];
const REGISTERED_CONTENT = "Document content";
const TAMPERED_CONTENT = "Document content-MODIFIED";

async function sendVerify(variant, useTamperedContent = false) {
  const content = useTamperedContent ? TAMPERED_CONTENT : REGISTERED_CONTENT;
  const file = Buffer.from(content).toString("base64");

  const endpoint =
    `${CONFIG.apiUrl}/api/document/verify-ablation/` +
    `${CONFIG.orgName}/ablate/${variant}`;

  const res = await axios.post(
    endpoint,
    {
      id: CONFIG.documentID,
      file,
    },
    {
      headers: {
        Authorization: `Bearer ${CONFIG.authToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  return res.data;
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function testCleanState() {
  console.log("\n=== CLEAN STATE ===");

  for (const variant of VARIANTS) {
    const result = await sendVerify(variant, false);

    console.log(
      `${variant}: status=${result.status} detected=${result.detected}`
    );

    assertCondition(
      result.detected === false,
      `${variant} produced false positive`
    );
  }
}

async function testContentOnly() {
  console.log("\n=== CONTENT ONLY ===");

  const expected = {
    V0: true,
    V1: false,
    V2: false,
    V3: false,
    V4: true,
  };

  for (const variant of VARIANTS) {
    const result = await sendVerify(variant, true);

    console.log(
      `${variant}: status=${result.status} detected=${result.detected}`
    );

    assertCondition(
      result.detected === expected[variant],
      `${variant} unexpected content-only result`
    );
  }

  const v4 = await sendVerify("V4", true);

  assertCondition(
    v4.status === "DOCUMENT_MODIFIED",
    `V4 expected DOCUMENT_MODIFIED, got ${v4.status}`
  );
  assertCondition(v4.layer1 === true, "V4 Layer 1 should pass");
  assertCondition(v4.layer2 === false, "V4 Layer 2 should fail");
}

async function testRecordOnly() {
  console.log("\n=== RECORD ONLY ===");

  const snapshots = await snapshotBatch([CONFIG.documentID]);

  try {
    const tamperResult = await tamperBatch(
      [CONFIG.documentID],
      ["change_description"]
    );

    assertCondition(
      tamperResult.some((row) => row.ok),
      "Record tampering failed"
    );

    const expected = {
      V0: false,
      V1: true,
      V2: true,
      V3: true,
      V4: true,
    };

    for (const variant of VARIANTS) {
      const result = await sendVerify(variant, false);

      console.log(
        `${variant}: status=${result.status} detected=${result.detected}`
      );

      assertCondition(
        result.detected === expected[variant],
        `${variant} unexpected record-only result`
      );
    }

    const v4 = await sendVerify("V4", false);

    assertCondition(v4.layer1 === false, "V4 Layer 1 should fail");
    assertCondition(v4.layer2 === null, "V4 Layer 2 should be skipped");
  } finally {
    await restoreBatch(snapshots);
  }
}

async function testCombined() {
  console.log("\n=== COMBINED ===");

  const snapshots = await snapshotBatch([CONFIG.documentID]);

  try {
    const tamperResult = await tamperBatch(
      [CONFIG.documentID],
      ["change_description"]
    );

    assertCondition(
      tamperResult.some((row) => row.ok),
      "Combined tampering failed"
    );

    for (const variant of VARIANTS) {
      const result = await sendVerify(variant, true);

      console.log(
        `${variant}: status=${result.status} detected=${result.detected}`
      );
    }

    const v4 = await sendVerify("V4", true);

    assertCondition(v4.detected === true, "V4 failed combined detection");
    assertCondition(v4.layer1 === false, "V4 should fail Layer 1 first");
    assertCondition(v4.layer2 === null, "V4 should short-circuit Layer 2");
    assertCondition(
      v4.failedLayer === "layer1_private_record",
      "Unexpected V4 failed layer"
    );
  } finally {
    await restoreBatch(snapshots);
  }
}

async function testCoupledDocumentReferenceSubstitution() {
  console.log("\n=== COUPLED DOCUMENT-REFERENCE SUBSTITUTION ===");

  const snapshots = await snapshotBatch([CONFIG.documentID]);

  try {
    const tamperResult = await tamperBatch(
      [CONFIG.documentID],
      ["coupled_document_reference"]
    );

    assertCondition(
      tamperResult.some((row) => row.ok),
      "Coupled tampering failed"
    );

    const v0 = await sendVerify("V0", true);

    console.log(
      `V0: status=${v0.status} detected=${v0.detected}`
    );

    assertCondition(
      v0.status === "CONTENT_INTACT",
      `V0 expected CONTENT_INTACT, got ${v0.status}`
    );

    assertCondition(
      v0.detected === false,
      "V0 should falsely accept coupled substitution"
    );

    const v4 = await sendVerify("V4", true);

    console.log(
      `V4: status=${v4.status} detected=${v4.detected}`
    );

    assertCondition(
      v4.status === "PDC_RECORD_COMPROMISED",
      `V4 expected PDC_RECORD_COMPROMISED, got ${v4.status}`
    );

    assertCondition(
      v4.detected === true,
      "V4 failed to detect coupled substitution"
    );

    assertCondition(
      v4.layer1 === false,
      "V4 Layer 1 should fail"
    );

    assertCondition(
      v4.layer2 === null,
      "V4 Layer 2 should not be evaluated"
    );
  } finally {
    await restoreBatch(snapshots);
  }
}

async function testRestoredState() {
  console.log("\n=== RESTORED STATE ===");

  const result = await sendVerify("V4", false);

  console.log(
    `V4: status=${result.status} detected=${result.detected}`
  );

  assertCondition(
    result.status === "INTACT",
    `Expected restored state INTACT, got ${result.status}`
  );
}

async function main() {
  await testCleanState();
  await testContentOnly();
  await testRecordOnly();
  await testCombined();
  await testCoupledDocumentReferenceSubstitution()
  await testRestoredState();

  console.log("\n=== ALL FULL-PATH TESTS PASSED ===");
}

main().catch((err) => {
  console.error("\nFULL-PATH TEST FAILED");
  console.error(err);
  process.exit(1);
});
