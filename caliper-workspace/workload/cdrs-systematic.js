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
  attackRatios: (process.env.ATTACK_RATIOS || "0.01,0.05,0.10,0.25")
    .split(",").map(Number),
  seeds: (process.env.SEEDS || "43,20,33,13,25")
    .split(",").map(Number),
};

if (!CONFIG.authToken) throw new Error("Missing API_AUTH_TOKEN");

const REGISTERED_CONTENT = "Document content";
const TAMPERED_CONTENT = "Document content-MODIFIED";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function allDocumentIDs() {
  return Array.from(
    { length: CONFIG.docsPerRun },
    (_, i) => `${CONFIG.documentPrefix}${i + 1}`
  );
}

async function verify(documentID, variant, tampered = false) {
  const content = tampered ? TAMPERED_CONTENT : REGISTERED_CONTENT;

  const endpoint =
    `${CONFIG.apiUrl}/api/document/verify-ablation/` +
    `${CONFIG.orgName}/ablate/${variant}`;

  const res = await axios.post(
    endpoint,
    {
      id: documentID,
      file: Buffer.from(content).toString("base64"),
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

async function assertClean(docIDs, label) {
  for (const id of docIDs) {
    const r = await verify(id, "V4", false);
    assert(
      r.status === "INTACT" && r.detected === false,
      `${label}: ${id} is not clean`
    );
  }

  console.log(`${label}: ${docIDs.length}/${docIDs.length} V4 INTACT`);
}

async function runRound(round, attackRatio, seed) {
  const docs = allDocumentIDs();
  const random = rng(seed + round);

  const attackCount = Math.max(
    1,
    Math.round(CONFIG.docsPerRun * attackRatio)
  );

  const targets = shuffle(docs, random).slice(0, attackCount);
  const targetSet = new Set(targets);

  console.log(
    `\n=== CDRS round=${round} seed=${seed} ratio=${attackRatio} targets=${attackCount} ===`
  );

  await assertClean(docs, "pre-round");

  const snapshots = await snapshotBatch(targets);

  try {
    const tamperResults = await tamperBatch(
      targets,
      ["coupled_document_reference"],
      { rng: random }
    );

    const successful = new Set(
      tamperResults
        .filter((r) => r.ok)
        .map((r) => r.docID || r.documentID)
    );

    for (const id of targets) {
      assert(successful.has(id), `CDRS tampering failed for ${id}`);
    }

    const result = {
      round,
      seed,
      attackRatio,
      total: docs.length,
      attackedCount: targets.length,
      cleanCount: docs.length - targets.length,
      v0FalseAccept: 0,
      v0Detected: 0,
      v0CleanFP: 0,
      v4Detected: 0,
      v4Layer1Reject: 0,
      v4CleanFP: 0,
    };

    for (const id of docs) {
      const attacked = targetSet.has(id);

      const v0 = await verify(id, "V0", attacked);
      const v4 = await verify(id, "V4", attacked);

      if (attacked) {
        if (
          v0.status === "CONTENT_INTACT" &&
          v0.detected === false
        ) {
          result.v0FalseAccept++;
        }

        if (v0.detected === true) {
          result.v0Detected++;
        }

        if (v4.detected === true) {
          result.v4Detected++;
        }

        if (
          v4.status === "PDC_RECORD_COMPROMISED" &&
          v4.layer1 === false &&
          v4.layer2 === null
        ) {
          result.v4Layer1Reject++;
        }
      } else {
        if (v0.detected === true) result.v0CleanFP++;
        if (v4.detected === true) result.v4CleanFP++;
      }
    }

    assert(
      result.v0FalseAccept === result.attackedCount,
      `V0 false acceptance ${result.v0FalseAccept}/${result.attackedCount}`
    );

    assert(
      result.v4Detected === result.attackedCount,
      `V4 detection ${result.v4Detected}/${result.attackedCount}`
    );

    assert(
      result.v4Layer1Reject === result.attackedCount,
      `V4 Layer-1 rejection ${result.v4Layer1Reject}/${result.attackedCount}`
    );

    assert(result.v0CleanFP === 0, "V0 produced clean-state false positives");
    assert(result.v4CleanFP === 0, "V4 produced clean-state false positives");

    result.v0FalseAcceptanceRate =
      result.v0FalseAccept / result.attackedCount;

    result.v4DetectionRate =
      result.v4Detected / result.attackedCount;

    result.v4Layer1RejectRate =
      result.v4Layer1Reject / result.attackedCount;

    return result;
  } finally {
    const restoreResults = await restoreBatch(snapshots);

    const failed = restoreResults.filter((r) => !r.ok);
    assert(failed.length === 0, `Restore failed: ${JSON.stringify(failed)}`);

    await assertClean(targets, "post-restore");
  }
}

function summarize(results) {
  const sum = (field) =>
    results.reduce((n, r) => n + r[field], 0);

  const summary = {
    rounds: results.length,
    totalDecisionsPerVariant: sum("total"),
    attackedStates: sum("attackedCount"),
    cleanStates: sum("cleanCount"),
    v0FalseAccept: sum("v0FalseAccept"),
    v0Detected: sum("v0Detected"),
    v0CleanFP: sum("v0CleanFP"),
    v4Detected: sum("v4Detected"),
    v4Layer1Reject: sum("v4Layer1Reject"),
    v4CleanFP: sum("v4CleanFP"),
  };

  summary.v0FalseAcceptanceRate =
    summary.v0FalseAccept / summary.attackedStates;

  summary.v4DetectionRate =
    summary.v4Detected / summary.attackedStates;

  summary.v4Layer1RejectRate =
    summary.v4Layer1Reject / summary.attackedStates;

  return summary;
}

async function main() {
  const results = [];
  let round = 0;

  for (const attackRatio of CONFIG.attackRatios) {
    for (const seed of CONFIG.seeds) {
      const r = await runRound(round, attackRatio, seed);
      results.push(r);

      console.log(
        `Round ${round}: attacked=${r.attackedCount}, ` +
        `V0 FAR=${(r.v0FalseAcceptanceRate * 100).toFixed(2)}%, ` +
        `V4 DR=${(r.v4DetectionRate * 100).toFixed(2)}%`
      );

      round++;
    }
  }

  const summary = summarize(results);

  fs.writeFileSync(
    "cdrs_systematic_detail.json",
    JSON.stringify({ summary, rounds: results }, null, 2)
  );

  const csv = [
    [
      "round",
      "seed",
      "attack_ratio",
      "total",
      "attacked_count",
      "clean_count",
      "v0_false_accept",
      "v0_far",
      "v4_detected",
      "v4_detection_rate",
      "v4_layer1_reject",
      "v4_layer1_reject_rate",
    ].join(","),
    ...results.map((r) =>
      [
        r.round,
        r.seed,
        r.attackRatio,
        r.total,
        r.attackedCount,
        r.cleanCount,
        r.v0FalseAccept,
        r.v0FalseAcceptanceRate,
        r.v4Detected,
        r.v4DetectionRate,
        r.v4Layer1Reject,
        r.v4Layer1RejectRate,
      ].join(",")
    ),
  ].join("\n");

  fs.writeFileSync("cdrs_systematic_rounds.csv", csv + "\n");

  console.log("\n=== SYSTEMATIC CDRS COMPLETE ===");
  console.log(`Rounds              : ${summary.rounds}`);
  console.log(`Attacked states     : ${summary.attackedStates}`);
  console.log(`Clean states        : ${summary.cleanStates}`);
  console.log(
    `V0 false acceptance : ${summary.v0FalseAccept}/${summary.attackedStates} ` +
    `(${(summary.v0FalseAcceptanceRate * 100).toFixed(2)}%)`
  );
  console.log(
    `V4 detection        : ${summary.v4Detected}/${summary.attackedStates} ` +
    `(${(summary.v4DetectionRate * 100).toFixed(2)}%)`
  );
  console.log(
    `V4 Layer-1 rejection: ${summary.v4Layer1Reject}/${summary.attackedStates} ` +
    `(${(summary.v4Layer1RejectRate * 100).toFixed(2)}%)`
  );
}

main().catch((err) => {
  console.error("\nSYSTEMATIC CDRS FAILED");
  console.error(err);
  process.exit(1);
});
