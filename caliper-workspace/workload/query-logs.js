"use strict";

const { WorkloadModuleBase } = require("@hyperledger/caliper-core");

class QueryLogsWorkload extends WorkloadModuleBase {
  constructor() {
    super();
    this.queryCounter = 0;
    this.successCount = 0;
    this.failCount = 0;
    this.emptyResultCount = 0;
    this.totalResultCount = 0;
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
    this.collectionLog = roundArguments.collectionLog || "collectionOrg1Log";
    this.totalDocuments = roundArguments.totalDocuments || 100;
    this.queryCounter = workerIndex;

    console.log(
      `Worker ${workerIndex}: Query initialized for ${this.orgName}, collection ${this.collectionLog}`
    );
    console.log(
      `Worker ${workerIndex}: Will query documents DOC-0 to DOC-${
        this.totalDocuments - 1
      }`
    );
  }

  async submitTransaction() {
    const documentIndex = this.queryCounter % this.totalDocuments;
    const documentID = `DOC-${documentIndex}`;
    this.queryCounter++;

    const request = {
      contractId: "basic",
      contractFunction: "ReadAllLogByDocumentID",
      contractArguments: [this.collectionLog, documentID],
      readOnly: true,
    };

    try {
      const response = await this.sutAdapter.sendRequests(request);

      // Check if the response indicates success
      if (response && response.status === "success") {
        this.successCount++;

        // Parse the result from the response
        try {
          const resultString =
            response.result?.toString() || response.GetResult?.toString() || "";

          if (resultString) {
            const logs = JSON.parse(resultString);

            if (Array.isArray(logs)) {
              if (logs.length === 0) {
                this.emptyResultCount++;
              } else {
                this.totalResultCount += logs.length;
              }
            }
          } else {
            this.emptyResultCount++;
          }
        } catch (e) {
          console.log(`Could not parse result for ${documentID}: ${e.message}`);
          this.emptyResultCount++;
        }
      } else {
        this.failCount++;
      }
    } catch (error) {
      this.failCount++;
      console.error(`Error querying logs for ${documentID}: ${error.message}`);
    }
  }

  async cleanupWorkloadModule() {
    const total = this.successCount + this.failCount;
    const successRate =
      total > 0 ? ((this.successCount / total) * 100).toFixed(2) : 0;
    const avgLogsPerDoc =
      this.successCount > 0
        ? (this.totalResultCount / this.successCount).toFixed(2)
        : 0;

    console.log(`Worker completed:`);
    console.log(`  Total queries: ${total}`);
    console.log(`  Successful: ${this.successCount} (${successRate}%)`);
    console.log(`  Failed: ${this.failCount}`);
    console.log(`  Empty results: ${this.emptyResultCount}`);
    console.log(`  Total logs found: ${this.totalResultCount}`);
    console.log(`  Avg logs per document: ${avgLogsPerDoc}`);
  }
}

function createWorkloadModule() {
  return new QueryLogsWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
