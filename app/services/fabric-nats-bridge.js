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
        `FABRIC_WEBHOOK_QUEUE_${this.orgName.toUpperCase()}`,
        [`fabric.${this.orgName}.webhook.create`]
      );

      await this.natsService.createStream(
        `FABRIC_WEBHOOK_STATUS_${this.orgName.toUpperCase()}`,
        [`fabric.${this.orgName}.webhook.status.*`]
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

      await this.natsService.createConsumer(
        `FABRIC_WEBHOOK_QUEUE_${this.orgName.toUpperCase()}`,
        `${this.orgName}_webhook_processor`,
        `fabric.${this.orgName}.webhook.create`
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

    await this.natsService.subscribe(
      `FABRIC_WEBHOOK_QUEUE_${this.orgName.toUpperCase()}`,
      `${this.orgName}_webhook_processor`,
      async (data, msg) => {
        await this.processWebhook(data, msg);
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
      msg.ack();
    } catch (error) {
      console.error("Error processing invoke command:", error);

      await this.sendResponse(requestId, {
        success: false,
        error: error.message,
        org: this.orgName,
      });
      msg.ack();
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
      userId: args[7],
      orgName: this.orgName,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    try {
      await this.natsService.publish(
        `fabric.${this.orgName}.webhook.create`,
        webhookData
      );

      await this.saveWebhookStatus(requestId, "queued", {
        message: "Webhook queued for processing",
        documentId: webhookData.id,
      });

      console.log(`Webhook ${requestId} queued successfully`);

      return {
        success: true,
        message: "Webhook queued for processing",
        requestId: requestId,
        data: {
          id: webhookData.id,
          documentCategoryCode: webhookData.documentCategoryCode,
          name: webhookData.name,
          collection: webhookData.collection,
        },
      };
    } catch (error) {
      console.error(`Failed to queue webhook ${requestId}:`, error);

      await this.saveWebhookStatus(requestId, "queue_failed", {
        error: error.message,
      });

      throw error;
    }
  }

  async saveWebhookStatus(requestId, status, metadata = {}) {
    const payload = {
      requestId,
      status,
      timestamp: new Date().toISOString(),
      ...metadata,
    };

    await this.natsService.publish(
      `fabric.${this.orgName}.webhook.status.${requestId}`,
      payload
    );

    await this.natsService.kv.put(
      `webhook_status_${requestId}`,
      Buffer.from(JSON.stringify(payload))
    );
  }

  async processWebhook(webhookData, msg) {
    const { requestId } = webhookData;
    const deliveryCount = msg.info?.deliveryCount || 1;

    try {
      console.log(`Processing webhook ${requestId} (attempt ${deliveryCount})`);
      await this.saveWebhookStatus(requestId, "processing", {
        attempt: deliveryCount,
        documentId: webhookData.id,
      });

      const result = await fabricService.createPrivateDataWebhook(
        webhookData,
        webhookData.userId,
        this.orgName
      );
      await this.saveWebhookStatus(requestId, "completed", {
        txId: result?.txId || null,
        message: result?.message,
        documentId: webhookData.id,
      });

      console.log(
        `Webhook ${requestId} processed successfully with txId: ${result?.txId}`
      );

      msg.ack();
    } catch (error) {
      console.error(
        `Webhook ${requestId} processing failed (attempt ${deliveryCount}):`,
        error
      );
      await this.saveWebhookStatus(requestId, "failed", {
        error: error.message,
        attempt: deliveryCount,
        documentId: webhookData.id,
      });
      if (this.isRetryableError(error) && deliveryCount < 3) {
        const delayMs = Math.min(5000 * deliveryCount, 30000);
        console.warn(`Retrying webhook ${requestId} in ${delayMs}ms`);
        msg.nak(delayMs);
      } else {
        console.error(`Webhook ${requestId} permanently failed, moving to DLQ`);

        await this.saveWebhookStatus(requestId, "dlq", {
          error: error.message,
          finalAttempt: deliveryCount,
          documentId: webhookData.id,
        });

        await this.natsService.publish(`fabric.${this.orgName}.dlq`, {
          type: "webhook",
          subject: msg.subject,
          error: error.message,
          data: webhookData,
          retries: deliveryCount,
          timestamp: new Date().toISOString(),
        });

        msg.ack();
      }
    }
  }

  isRetryableError(error) {
    const msg = error.message.toLowerCase();

    if (this.isPermanentError(msg)) return false;
    if (this.isFabricInfraError(msg)) return true;
    if (this.isNetworkError(msg)) return true;

    return false;
  }

  isPermanentError(msg) {
    return [
      "does not have write access",
      "validation",
      "not found",
      "invalid",
      "unauthorized",
      "permission denied",
      "already exists",
    ].some((e) => msg.includes(e));
  }

  isFabricInfraError(msg) {
    return [
      "discoveryservice",
      "no discovery results",
      "failed to connect before the deadline",
    ].some((e) => msg.includes(e));
  }

  isNetworkError(msg) {
    return [
      "timeout",
      "network",
      "econnrefused",
      "etimedout",
      "econnreset",
      "temporarily unavailable",
      "connection refused",
      "service unavailable",
    ].some((e) => msg.includes(e));
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
        GetWebhookStatus: () => this.getWebhookStatus(args[0]),
      };

      let result;
      result = await queryHandlers[functionName]();

      await this.sendResponse(requestId, {
        success: true,
        result: result,
        org: this.orgName,
      });
      msg.ack();
    } catch (error) {
      console.error("Error processing query command:", error);

      await this.sendResponse(requestId, {
        success: false,
        error: error.message,
        org: this.orgName,
      });
      msg.ack();
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

  async getWebhookStatus(webhookRequestId) {
    try {
      const entry = await this.natsService.kv.get(
        `webhook_status_${webhookRequestId}`
      );

      if (!entry) {
        return {
          requestId: webhookRequestId,
          currentStatus: "not_found",
        };
      }

      const data = JSON.parse(entry.value.toString());

      return {
        requestId: webhookRequestId,
        currentStatus: data.status,
        lastUpdate: data.timestamp,
        metadata: data,
      };
    } catch (error) {
      return {
        requestId: webhookRequestId,
        currentStatus: "error",
        error: error.message,
      };
    }
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

  async close() {
    await this.natsService.close();
  }
}

module.exports = FabricNatsBridge;
