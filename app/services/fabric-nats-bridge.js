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
        CreatePrivateDocument: () => this.handleCreateDocument(args),
        CreatePrivateLogDocument: () => this.handleCreateLog(args),
      };

      let result;
      if (invokeHandlers[functionName]) {
        result = await invokeHandlers[functionName]();
      } else {
        result = await this.handleGenericInvoke(
          functionName,
          args,
          transientData,
        );
      }

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

  async handleCreateLog(args) {
    const logData = {
      collectionLog: args[0] || this.orgConfig.collections.logs,
      documentID: args[1],
      actorID: args[2],
      actorName: args[3],
      action: args[4],
    };
    return await fabricService.createPrivateLogDocument(
      logData,
      args[5],
      this.orgName
    );
  }

  async handleCreateDocument(args) {
    const docData = {
      collection: args[0] || this.orgConfig.collections.documents,
      documentID: args[1],
      documentName: args[2],
      ownerID: args[3],
      ownerName: args[4],
      status: args[5],
    };
    return await fabricService.createPrivateDocument(
      docData,
      args[6],
      this.orgName
    );
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
        ReadAllDocumentsByOrg: () => this.handleReadAllDocuments(args, userId),
        ReadAllLogsByDocumentID: () => this.handleReadAllLogs(args, userId),
      };

      let result;
      if (queryHandlers[functionName]) {
        result = await queryHandlers[functionName]();
      } else {
        result = await this.handleGenericQuery(functionName, args, userId);
      }

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

  async handleReadAllDocuments(args, userId) {
    const collection = args[0] || this.orgConfig.collections.documents;
    return await fabricService.readAllDocumentsByOrg(
      collection,
      userId,
      this.orgName
    );
  }

  async handleReadAllLogs(args, userId) {
    const collectionLog = args[0] || this.orgConfig.collections.logs;
    const documentID = args[1];
    return await fabricService.readAllLogsByDocumentID(
      collectionLog,
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
