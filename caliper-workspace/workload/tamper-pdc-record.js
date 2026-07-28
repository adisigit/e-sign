"use strict";
// ============================================================
// tamper-pdc-record.js
//
// Direct CouchDB tamper helper. Replaces manual Fauxton edits with
// reproducible, scriptable mutations against the PDC-backing CouchDB
// database, via the same REST API Fauxton itself uses.
//
// SETUP (do this once, via Fauxton):
//   1. Find the exact CouchDB database name for your collection.
//      Fabric names PDC-backing databases like:
//        <channel>_<chaincode>$$p<collectionNameHash>
//      Open Fauxton -> look at the database list -> copy the exact name.
//   2. Confirm a registered doc's _id matches your docID, and note
//      that CouchDB requires _rev on every update (handled below).
//   3. Set COUCHDB_URL / COUCHDB_USER / COUCHDB_PASS / COUCHDB_DB env vars.
//
// USAGE:
//   node tamper-pdc-record.js <docID> <mutationName>
//   node tamper-pdc-record.js --list
// ============================================================

const axios = require("axios");

const PEER_TARGETS = [
  { name: "peer0", url: process.env.COUCHDB_PEER0_URL, user: process.env.COUCHDB_PEER0_USER, pass: process.env.COUCHDB_PEER0_PASS, db: process.env.COUCHDB_DB },
  { name: "peer1", url: process.env.COUCHDB_PEER1_URL, user: process.env.COUCHDB_PEER1_USER, pass: process.env.COUCHDB_PEER1_PASS, db: process.env.COUCHDB_DB },
];

async function getDocFrom(peer, docID) {
  const url = `${peer.url}/${encodeURIComponent(peer.db)}/${encodeURIComponent(docID)}`;
  const res = await axios.get(url, { auth: { username: peer.user, password: peer.pass } });
  return res.data;
}

async function putDocTo(peer, doc) {
  const url = `${peer.url}/${encodeURIComponent(peer.db)}/${encodeURIComponent(doc._id)}`;
  return axios.put(url, doc, { auth: { username: peer.user, password: peer.pass }, headers: { "Content-Type": "application/json" } });
}

// ============================================================
// MUTATION REGISTRY
//
// Each function receives the raw CouchDB doc (from getDoc) and returns
// a mutated doc. _id/_rev are preserved automatically by putDoc's URL
// and CouchDB's own versioning -- they are CouchDB metadata, not part
// of the application-level canonical JSON value the chaincode hashes,
// so mutating them is out of scope for these tests.
// ============================================================
const MUTATIONS = {
  // ---- expect chaincode result: PDC_RECORD_COMPROMISED ----
  // (schema-valid, but canonical hash no longer matches ledger-committed PDC hash)
  change_permitted_value: (doc) => {
    doc.name = doc.name + "-TAMPERED";
    return doc;
  },
  change_description: (doc) => {
    doc.description = "modified description " + Date.now();
    return doc;
  },
  substitute_document_hash: (doc) => {
    // redirect the record to point at a different (attacker-controlled) document
    doc.file = "b".repeat(64);
    return doc;
  },
  change_category: (doc) => {
    doc.documentCategoryCode = doc.documentCategoryCode === "CONTRACT" ? "INVOICE" : "CONTRACT";
    return doc;
  },

  // ---- expect chaincode result: PDC_RECORD_SCHEMA_VIOLATION ----
  remove_required_field: (doc) => {
    delete doc.description;
    return doc;
  },
  add_unknown_field: (doc) => {
    doc.extraField = "injected";
    return doc;
  },
  null_required_field: (doc) => {
    doc.name = null;
    return doc;
  },
  duplicate_like_field: (doc) => {
    // CouchDB itself won't store literal duplicate JSON keys (it's parsed
    // into a JS object first), so true duplicate-key testing belongs in
    // the Go conformance suite (schema_conformance_test.go), not here.
    // This mutation instead tests a near-duplicate variant: same field,
    // different casing, to confirm it's rejected as unknown rather than
    // silently merged.
    doc.Name = doc.name; // "Name" vs "name" -- should be treated as unknown field
    return doc;
  },
  wrong_document_id_binding: (doc) => {
    doc.documentID = doc.documentID + "-WRONG";
    return doc;
  },
  wrong_collection_binding: (doc) => {
    doc.collection = "wrongCollection";
    return doc;
  },
  malformed_hash_length: (doc) => {
    doc.file = "abc123"; // not 64 hex chars
    return doc;
  },
  malformed_hash_not_hex: (doc) => {
    doc.file = "z".repeat(64); // right length, not valid hex
    return doc;
  },
  malformed_timestamp: (doc) => {
    doc.timestamp = "not-a-valid-date";
    return doc;
  },

  // ---- expect chaincode result: INTACT (must NOT be flagged) ----
  // Representation-only changes. Running these and confirming INTACT is
  // itself part of the conformance evidence (RFC 8785 equivalence holds
  // end-to-end, not just in isolated canonicalizeJSON unit tests).
  reorder_fields_only: (doc) => {
    const { _id, _rev, ...rest } = doc;
    const reordered = { _id, _rev };
    Object.keys(rest)
      .sort()
      .reverse()
      .forEach((k) => (reordered[k] = rest[k]));
    return reordered;
  },
};

async function tamperOneAllPeers(docID, mutationName) {
  const mutateFn = MUTATIONS[mutationName];
  const results = [];
  for (const peer of PEER_TARGETS) {
    const doc = await getDocFrom(peer, docID);
    // catatan: _rev BEDA per peer karena tiap CouchDB independen —
    // jangan reuse _rev dari peer lain
    const mutated = mutateFn({ ...doc });
    const result = await putDocTo(peer, mutated);
    results.push({ peer: peer.name, rev: result.data.rev });
  }
  console.log(`✅ Tampered ${docID} on ALL peers:`, results);
  return results;
}

async function tamperBatch(docIDs, mutationPool, { fixedMutation = null } = {}) {
  const results = [];
  for (const docID of docIDs) {
    const mutationName = fixedMutation || mutationPool[Math.floor(Math.random() * mutationPool.length)];
    try {
      await tamperOneAllPeers(docID, mutationName);
      results.push({ docID, mutationName, ok: true });
    } catch (err) {
      console.error(`❌ Failed to tamper ${docID}:`, err.response?.data || err.message);
      results.push({ docID, mutationName, ok: false, error: err.response?.data?.reason || err.message });
    }
  }
  return results;
}

module.exports = { getDocFrom, putDocTo, tamperOneAllPeers, tamperBatch, MUTATIONS };

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === "--list" || args.length === 0) {
    console.log("Available mutations:\n");
    console.log("  Expect PDC_RECORD_COMPROMISED:");
    ["change_permitted_value", "change_description", "substitute_document_hash", "change_category"].forEach((m) =>
      console.log(`    ${m}`)
    );
    console.log("\n  Expect PDC_RECORD_SCHEMA_VIOLATION:");
    [
      "remove_required_field",
      "add_unknown_field",
      "null_required_field",
      "duplicate_like_field",
      "wrong_document_id_binding",
      "wrong_collection_binding",
      "malformed_hash_length",
      "malformed_hash_not_hex",
      "malformed_timestamp",
    ].forEach((m) => console.log(`    ${m}`));
    console.log("\n  Expect INTACT (must NOT be flagged):");
    ["reorder_fields_only"].forEach((m) => console.log(`    ${m}`));
    console.log("\nUsage: node tamper-pdc-record.js <docID> <mutationName>");
    process.exit(0);
  }

  const [docID, mutationName] = args;
  if (!docID || !mutationName) {
    console.error("Usage: node tamper-pdc-record.js <docID> <mutationName>  (or --list)");
    process.exit(1);
  }

  tamperOneAllPeers(docID, mutationName).catch((e) => {
    console.error(e.response?.data || e.message);
    process.exit(1);
  });
}
