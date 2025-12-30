const NatsService = require("./nats-service");
const fabricService = require("./fabric-service");
const config = require("../config/fabric-config");

class FabricNatsBridge {
  constructor(orgName) {
    this.orgName = orgName;
    this.channelName = config.channelName;
    this.chaincodeName = config.chaincodeName;

    this.natsService = new NatsService(orgName);

    this.isInitialized = false;
    this.orgConfig = config.getOrgConfig(orgName);
  }

  async initialize() {
    try {
      console.log(`Initializing Fabric-NATS Bridge for ${this.orgName}...`);

      await this.natsService.connect();

      await this.setupNatsInfrastructure();

      await this.startListening();

      this.isInitialized = true;
      console.log(`Fabric-NATS Bridge initialized for ${this.orgName}\n`);
    } catch (error) {
      console.error(`Failed to initialize bridge:`, error);
      throw error;
    }
  }

  async setupNatsInfrastructure() {
    try {
      await this.natsService.createStream(
        `FABRIC_COMMANDS_${this.orgName.toUpperCase()}`,
        [`fabric.${this.orgName}.invoke.*`, `fabric.${this.orgName}.query.*`]
      );

      await this.natsService.createStream(
        `FABRIC_RESPONSES_${this.orgName.toUpperCase()}`,
        [`fabric.${this.orgName}.response.*`, `fabric.${this.orgName}.event.*`]
      );

      await this.natsService.createStream(
        `FABRIC_FIREFORGET_${this.orgName.toUpperCase()}`,
        [`fabric.${this.orgName}.fireforget.>`]
      );

      await this.natsService.createStream(
        `FABRIC_DLQ_${this.orgName.toUpperCase()}`,
        [`fabric.${this.orgName}.dlq`]
      );      

      await this.natsService.createConsumer(
        `FABRIC_COMMANDS_${this.orgName.toUpperCase()}`,
        `${this.orgName}_command_processor`,
        `fabric.${this.orgName}.invoke.*`
      );

      await this.natsService.createConsumer(
        `FABRIC_COMMANDS_${this.orgName.toUpperCase()}`,
        `${this.orgName}_query_processor`,
        `fabric.${this.orgName}.query.*`
      );
    } catch (error) {
      console.error("Error setting up NATS infrastructure:", error);
      throw error;
    }
  }

  async startListening() {
    await this.natsService.subscribe(
      `FABRIC_COMMANDS_${this.orgName.toUpperCase()}`,
      `${this.orgName}_command_processor`,
      async (data, msg) => {
        await this.handleInvokeCommand(data, msg);
      }
    );

    await this.natsService.subscribe(
      `FABRIC_COMMANDS_${this.orgName.toUpperCase()}`,
      `${this.orgName}_query_processor`,
      async (data, msg) => {
        await this.handleQueryCommand(data, msg);
      }
    );
  }

  async handleInvokeCommand(data, msg) {
    const { requestId, functionName, args, transientData } = data;

    try {
      console.log(`Processing invoke command from NATS:`, {
        requestId,
        functionName,
        org: this.orgName,
      });

      const invokeHandlers = {
        CreatePrivateDataWebhook: () => this.handleCreateWebhook(args),
      };

      let result;
      result = await invokeHandlers[functionName]();

      await this.sendResponse(requestId, {
        success: true,
        result: result,
        org: this.orgName,
      });
    } catch (error) {
      console.error("Error processing invoke command:", error);

      await this.sendResponse(requestId, {
        success: false,
        error: error.message,
        org: this.orgName,
      });
    }
  }

  async handleCreateWebhook(args) {
    const requestId = this.generateRequestId();

    const webhookData = {
      requestId,
      collection: args[0] || this.orgConfig.collections.documents,
      id: args[1],
      documentCategoryCode: args[2],
      name: args[3],
      description: args[4],
      file: args[5],
      recipients: args[6],
    };
    
    (async () => {
      try {
        const result = await fabricService.createPrivateDataWebhook(
          webhookData,
          args[7],
          this.orgName
        );
    
        await this.natsService.publish(
          `fabric.${this.orgName}.fireforget.webhook.success.${webhookData.requestId}`,
          {
            requestId: webhookData.requestId,
            type: "CreatePrivateDataWebhook",
            txId: result?.txId || null,
            timestamp: new Date().toISOString(),
          }
        );
      } catch (err) {
        await this.natsService.publish(
          `fabric.${this.orgName}.fireforget.webhook.error.${webhookData.requestId}`,
          {
            requestId: webhookData.requestId,
            type: "CreatePrivateDataWebhook",
            error: err.message,
            timestamp: new Date().toISOString(),
          }
        );
      }
    })();    

    return {
      success: true,
      message: "Webhook accepted (processing asynchronously)",
      data: webhookData,
    };
  }

  async handleQueryCommand(data, msg) {
    const { requestId, functionName, args, userId } = data;

    try {
      console.log(`Processing query command from NATS:`, {
        requestId,
        functionName,
        org: this.orgName,
      });

      const queryHandlers = {
        ReadAllLogsByDocumentIDWebhook: () =>
          this.handleReadAllLogsWebhook(args, userId),
        ReadAllLogByDocumentIDWithIntegrityCheck: () =>
          this.handleReadAllLogsWithIntegrityCheck(args, userId),
        ReadDocumentByIDWithIntegrityCheckWebhook: () =>
          this.handleReadDocumentByIDWithIntegrityCheckWebhook(args, userId),
      };

      let result;
      result = await queryHandlers[functionName]();

      await this.sendResponse(requestId, {
        success: true,
        result: result,
        org: this.orgName,
      });
    } catch (error) {
      console.error("Error processing query command:", error);

      await this.sendResponse(requestId, {
        success: false,
        error: error.message,
        org: this.orgName,
      });
    }
  }

  async handleReadAllLogsWebhook(args, userId) {
    const collectionLog = args[0] || this.orgConfig.collections.logs;
    const documentID = args[1];
    return await fabricService.readAllLogsByDocumentIDWebhook(
      collectionLog,
      documentID,
      userId,
      this.orgName
    );
  }

  async handleReadAllLogsWithIntegrityCheck(args, userId) {
    const collectionLog = args[0] || this.orgConfig.collections.logs;
    const documentID = args[1];
    return await fabricService.readAllLogByDocumentIDWithIntegrityCheck(
      collectionLog,
      documentID,
      userId,
      this.orgName
    );
  }

  async handleReadDocumentByIDWithIntegrityCheckWebhook(args, userId) {
    const collection = args[0] || this.orgConfig.collections.documents;
    const documentID = args[1];
    return await fabricService.readDocumentByIDWithIntegrityCheckWebhook(
      collection,
      documentID,
      userId,
      this.orgName
    );
  }

  async sendResponse(requestId, data) {
    try {
      await this.natsService.publish(
        `fabric.${this.orgName}.response.${requestId}`,
        {
          requestId,
          timestamp: new Date().toISOString(),
          ...data,
        }
      );
    } catch (error) {
      console.error("Error sending response to NATS:", error);
    }
  }

  async invokeViaClient(functionName, args, transientData = null) {
    const requestId = this.generateRequestId();
    try {
      await this.natsService.publish(
        `fabric.${this.orgName}.invoke.${functionName}`,
        {
          requestId,
          functionName,
          args,
          transientData,
          timestamp: new Date().toISOString(),
        }
      );

      return await this.waitForResponse(requestId);
    } catch (error) {
      console.error("Error invoking via client:", error);
      throw error;
    }
  }

  async queryViaClient(functionName, args, userId = "admin") {
    const requestId = this.generateRequestId();

    try {
      await this.natsService.publish(
        `fabric.${this.orgName}.query.${functionName}`,
        {
          requestId,
          functionName,
          args,
          userId,
          timestamp: new Date().toISOString(),
        }
      );

      return await this.waitForResponse(requestId);
    } catch (error) {
      console.error("Error querying via client:", error);
      throw error;
    }
  }

  async waitForResponse(requestId, timeout = 30000) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Response timeout"));
      }, timeout);
      const sub = this.natsService.connection.subscribe(
        `fabric.${this.orgName}.response.${requestId}`
      );

      (async () => {
        for await (const msg of sub) {
          clearTimeout(timeoutId);
          const response = this.natsService.jc.decode(msg.data);
          sub.unsubscribe();

          if (response.success) {
            resolve(response.result);
          } else {
            reject(new Error(response.error));
          }
        }
      })();
    });
  }

  generateRequestId() {
    return `${this.orgName}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
  }

  // async setupBlockListener() {
  //   try {
  //     await fabricService.listenToBlocks((block) => {
  //       this.natsService.publish(`fabric.${this.orgName}.event.block`, {
  //         blockNumber: block.blockNumber,
  //         channelName: this.channelName,
  //         org: this.orgName,
  //         timestamp: new Date().toISOString(),
  //       });
  //     });
  //   } catch (error) {
  //     console.error("Error setting up block listener:", error);
  //   }
  // }

  async close() {
    await this.natsService.close();
  }
}

module.exports = FabricNatsBridge;
