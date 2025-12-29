"use strict";
const { WorkloadModuleBase } = require("@hyperledger/caliper-core");
const crypto = require("crypto");

class CreateWebhookWorkload extends WorkloadModuleBase {
  constructor() {
    super();
    this.documentCounter = 0;
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
    
    console.log(
      `Worker ${workerIndex}: Initialized for ${this.orgName} with collection ${this.collection}`
    );
  }

  async submitTransaction() {
    this.documentCounter++;
    
    const mockFileContent = `Document content ${this.documentCounter}`;
    const fileHash = crypto
      .createHash("sha256")
      .update(mockFileContent)
      .digest("hex");
    
    const documentID = `DOC-${Date.now()}-${this.documentCounter}`;
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
      // Gateway API will throw error if transaction fails
      // No need to check result.GetStatus() - that doesn't exist
      await this.sutAdapter.sendRequests(request);
      
      // If we reach here, transaction was submitted and committed successfully
      return;
      
    } catch (error) {
      // Real errors will be caught here (endorsement failures, commit failures, etc.)
      console.error(`Worker ${this.workerIndex}: Transaction failed for ${this.collection}:`, error.message);
      throw error;
    }
  }

  async cleanupWorkloadModule() {
    console.log(`Worker completed: Created ${this.documentCounter} documents with webhooks`);
  }
}

function createWorkloadModule() {
  return new CreateWebhookWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;