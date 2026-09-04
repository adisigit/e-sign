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

const MUTATIONS = {
  change_permitted_value: (doc) => {
    doc.name = doc.name + "-TAMPERED";
    return doc;
  },
  change_description: (doc) => {
    doc.description = "modified description " + Date.now();
    return doc;
  },
  substitute_document_hash: (doc) => {
    doc.file = "b".repeat(64);
    return doc;
  },
  change_category: (doc) => {
    doc.documentCategoryCode = doc.documentCategoryCode === "CONTRACT" ? "INVOICE" : "CONTRACT";
    return doc;
  },

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
    doc.Name = doc.name;
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
    doc.file = "abc123";
    return doc;
  },
  malformed_hash_not_hex: (doc) => {
    doc.file = "z".repeat(64);
    return doc;
  },
  malformed_timestamp: (doc) => {
    doc.timestamp = "not-a-valid-date";
    return doc;
  },

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

const MUTATION_FIELDS = {
  change_permitted_value: "name",
  change_description: "description",
  substitute_document_hash: "file",
  change_category: "documentCategoryCode",

  remove_required_field: "description",
  add_unknown_field: "extraField",
  null_required_field: "name",
  duplicate_like_field: "Name",
  wrong_document_id_binding: "documentID",
  wrong_collection_binding: "collection",
  malformed_hash_length: "file",
  malformed_hash_not_hex: "file",
  malformed_timestamp: "timestamp",

  reorder_fields_only: null,
};

async function tamperOneAllPeers(docID, mutationName) {
  const mutateFn = MUTATIONS[mutationName];

  if (!mutateFn) {
    throw new Error(`Unknown mutation: ${mutationName}`);
  }

  const results = [];

  for (const peer of PEER_TARGETS) {
    const before = await getDocFrom(peer, docID);

    const mutated = mutateFn({ ...before });

    const result = await putDocTo(peer, mutated);

    const after = await getDocFrom(peer, docID);

    results.push({
      peer: peer.name,
      rev: result.data.rev,
      mutationName,
      mutatedField: MUTATION_FIELDS[mutationName] ?? null,
      beforeValue:
        MUTATION_FIELDS[mutationName]
          ? before[MUTATION_FIELDS[mutationName]]
          : null,
      afterValue:
        MUTATION_FIELDS[mutationName]
          ? after[MUTATION_FIELDS[mutationName]]
          : null,
    });
  }

  console.log(
    `✅ Tampered ${docID} on ALL peers:`,
    results
  );

  return results;
}

async function tamperBatch(docIDs, mutationPool, { fixedMutation = null,  rng = Math.random } = {}) {
  const results = [];
  for (const docID of docIDs) {
    const mutationName = fixedMutation || mutationPool[Math.floor(rng() * mutationPool.length)];
    try {
      await tamperOneAllPeers(docID, mutationName);
      results.push({
        docID,
        mutationName,
        mutationSubtype: mutationName,
        mutatedField: MUTATION_FIELDS[mutationName] ?? null,
        ok: true
      });
    } catch (err) {
      console.error(`❌ Failed to tamper ${docID}:`, err.response?.data || err.message);
      results.push({ docID, mutationName, ok: false, error: err.response?.data?.reason || err.message });
    }
  }
  return results;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function snapshotOneAllPeers(docID) {
  const snapshots = [];

  for (const peer of PEER_TARGETS) {
    const original = await getDocFrom(peer, docID);
    snapshots.push({
      peerName: peer.name,
      docID,
      original: clone(original),
    });
  }

  return snapshots;
}

async function snapshotBatch(docIDs) {
  const snapshots = {};

  for (const docID of docIDs) {
    snapshots[docID] = await snapshotOneAllPeers(docID);
  }

  return snapshots;
}

async function restoreOneAllPeers(snapshots) {
  const results = [];

  for (const snapshot of snapshots) {
    const peer = PEER_TARGETS.find((p) => p.name === snapshot.peerName);
    if (!peer) throw new Error(`Peer not found: ${snapshot.peerName}`);

    const current = await getDocFrom(peer, snapshot.docID);

    const restored = {
      ...clone(snapshot.original),
      _id: current._id,
      _rev: current._rev,
    };

    const result = await putDocTo(peer, restored);

    results.push({
      peer: peer.name,
      docID: snapshot.docID,
      rev: result.data.rev,
      restored: true,
    });
  }

  return results;
}

async function restoreBatch(snapshotMap) {
  const results = [];

  for (const [docID, snapshots] of Object.entries(snapshotMap)) {
    try {
      const restored = await restoreOneAllPeers(snapshots);
      results.push({ docID, ok: true, peers: restored });
    } catch (err) {
      console.error(`❌ Restore failed ${docID}:`, err.response?.data || err.message);
      results.push({ docID, ok: false, error: err.response?.data?.reason || err.message });
    }
  }

  return results;
}

module.exports = {
  getDocFrom,
  putDocTo,
  tamperOneAllPeers,
  tamperBatch,
  snapshotOneAllPeers,
  snapshotBatch,
  restoreOneAllPeers,
  restoreBatch,
  MUTATIONS
};

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
