"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const crypto = require("crypto");

class CreateWebhookWorkload extends WorkloadModuleBase {
  constructor() {
    super();
    this.documentCounter = 0;
    this.documentRound = 160;
    this.roundIndex = 0;
  }

  async initializeWorkloadModule(
    workerIndex,
    totalWorkers,
    roundIndex,
    roundArguments,
    sutAdapter,
    sutContext
  ) {
    await super.initializeWorkloadModule(
      workerIndex,
      totalWorkers,
      roundIndex,
      roundArguments,
      sutAdapter,
      sutContext
    );

    this.orgName = roundArguments.orgName || "org1";
    this.collection = roundArguments.collection || "collectionOrg1";
    this.documentCounter = workerIndex * 10000;
    this.roundIndex = roundIndex; // ← simpan round

    console.log(
      `Worker ${workerIndex}: Initialized for ${this.orgName}, ` +
      `collection: ${this.collection}, round: ${this.documentRound}`
    );
  }

  async submitTransaction() {
    this.documentCounter++;

    const mockFileContent = `Document content`;
    const fileBuffer = Buffer.from(mockFileContent);
    const fileHash = crypto
      .createHash("sha256")
      .update(fileBuffer)
      .digest("hex");

    // DOCUMENT-<workerIndex>-<roundIndex>-<counter>
    // → unik meski dijalankan berkali-kali
    const documentID = `DOCS-${this.workerIndex}-${this.documentRound}-${this.documentCounter}`;

    const categories = ["CONTRACT", "INVOICE", "AGREEMENT", "REPORT", "POLICY"];
    const categoryCode = categories[Math.floor(Math.random() * categories.length)];

    const recipientCount = Math.floor(Math.random() * 4) + 2;
    const recipients = [];
    for (let i = 0; i < recipientCount; i++) {
      recipients.push({
        userId: `USER-${Math.floor(Math.random() * 100)}`,
        name: `User ${Math.floor(Math.random() * 50)}`,
        userRoleCode: "VIEWER",
        recipientRoleCode: Math.random() > 0.5 ? "SIGNER" : "APPROVER",
      });
    }

    const webhookData = {
      collection: this.collection,
      id: documentID,
      documentCategoryCode: categoryCode,
      name: `Document ${this.documentCounter}`,
      description: `Test document for performance testing - ${categoryCode}`,
      file: fileHash,
      recipients: recipients,
    };

    const transientMap = {
      webhook: Buffer.from(JSON.stringify(webhookData)),
    };

    const request = {
      contractId: "basic",
      contractFunction: "CreatePrivateDataWebhook",
      contractArguments: [],
      transientMap: transientMap,
      readOnly: false,
    };

    try {
      await this.sutAdapter.sendRequests(request);
      return;
    } catch (error) {
      console.error(
        `Worker ${this.workerIndex}: Transaction failed for ${this.collection}:`,
        error.message
      );
      throw error;
    }
  }

  async cleanupWorkloadModule() {
    console.log(
      `Worker ${this.workerIndex}: Created ${this.documentCounter} documents. ` +
      `IDs: DOCUMENT-${this.workerIndex}-${this.documentRound}-${this.workerIndex * 10000 + 1} ` +
      `→ DOCUMENT-${this.workerIndex}-${this.documentRound}-${this.documentCounter}`
    );
  }
}

function createWorkloadModule() {
  return new CreateWebhookWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
