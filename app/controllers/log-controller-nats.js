const BridgeController = require("../controllers/bridge-controller");
const config = require("../config/fabric-config");

class LogController {
  constructor() {
    this.bridgeController = BridgeController;
  }

  async createPrivateLogDocumentOrg(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { collectionLog, documentID, action } = req.body;

      const userId = req.walletUserId;
      const actorID = req.user.userId;
      const actorName = req.user.name;

      if (!config.organizations[orgName]) {
        return res.status(400).json({
          success: false,
          error: `Organization ${orgName} not found`,
          availableOrgs: config.getAllOrgs(),
        });
      }

      if (!this.bridgeController.getBridge(orgName)) {
        return res.status(500).json({
          success: false,
          error: `Bridge for ${orgName} not found`,
        });
      }

      if (!documentID || !actorID || !actorName || !action) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: documentID, actorID, actorName, action",
        });
      }

      const orgConfig = config.getOrgConfig(orgName);

      const targetCollection = orgConfig.collections.logs;
      // const targetCollection = collectionLog || orgConfig.collections.logs;
      // const natsService = this.bridgeController.getBridge(orgName).natsService;
      // const requestId = crypto.randomUUID();

      // natsService.publish(`fabric.${orgName}.invoke.CreatePrivateLogDocument`, {
      //   requestId,
      //   functionName: "CreatePrivateLogDocument",
      //   args: [
      //     targetCollection,
      //     documentID,
      //     actorID,
      //     actorName,
      //     action,
      //     userId,
      //   ],
      //   timestamp: Date.now(),
      // });

      // return res.status(200).json({
      //   success: true,
      //   queued: true,
      //   message: "Log submitted to queue",
      //   data: {
      //     orgName,
      //     documentID,
      //   },
      // });
      const result = await this.bridgeController
        .getBridge(orgName)
        .invokeViaClient(
          "CreatePrivateLogDocument",
          [targetCollection, documentID, actorID, actorName, action, userId],
          null
        );
      res.json(result);
    } catch (error) {
      console.error(`Error creating log for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async createPrivateLogDocumentOrgWebhook(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const {id, name, description} = req.body;
      const documentID = id;
      const documentName = name;
      const documentDescription = description;
      const action = 'SiGNING';
      const userId = 'cek';

      if (!config.organizations[orgName]) {
        return res.status(400).json({
          success: false,
          error: `Organization ${orgName} not found`,
          availableOrgs: config.getAllOrgs(),
        });
      }

      if (!this.bridgeController.getBridge(orgName)) {
        return res.status(500).json({
          success: false,
          error: `Bridge for ${orgName} not found`,
        });
      }

      if (!documentID || !documentName || !documentDescription || !action) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: documentID, documentName, documentDescription, action",
        });
      }

      const orgConfig = config.getOrgConfig(orgName);

      const targetCollection = orgConfig.collections.logs;
      const result = await this.bridgeController
        .getBridge(orgName)
        .invokeViaClient(
          "CreatePrivateLogDocumentWebhook",
          [targetCollection, documentID, documentName, documentDescription, action, userId],
          null
        );
      res.json(result);
    } catch (error) {
      console.error(`Error creating log for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getLogsByDocumentId(req, res) {
    try {
      const { orgName = "org1", documentID } = req.params;
      const { collectionLog } = req.query;
      const userId = req.walletUserId;

      if (!config.organizations[orgName]) {
        return res.status(400).json({
          success: false,
          error: `Organization ${orgName} not found`,
          availableOrgs: config.getAllOrgs(),
        });
      }

      if (!this.bridgeController.getBridge(orgName)) {
        return res.status(500).json({
          success: false,
          error: `Bridge for ${orgName} not found`,
        });
      }

      if (!documentID) {
        return res.status(400).json({
          success: false,
          error: "documentID parameter is required",
        });
      }

      const orgConfig = config.getOrgConfig(orgName);
      const targetCollection = collectionLog || orgConfig.collections.logs;

      const result = await this.bridgeController
        .getBridge(orgName)
        .queryViaClient(
          "ReadAllLogsByDocumentID",
          [targetCollection, documentID],
          userId
        );
      res.json(result);
    } catch (error) {
      console.error(`Error reading logs for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getLogsByDocumentIdWebhook(req, res) {
    try {
      const { orgName = "org1", documentID } = req.params;
      const { collectionLog } = req.query;
      const userId = 'cek';

      if (!config.organizations[orgName]) {
        return res.status(400).json({
          success: false,
          error: `Organization ${orgName} not found`,
          availableOrgs: config.getAllOrgs(),
        });
      }

      if (!this.bridgeController.getBridge(orgName)) {
        return res.status(500).json({
          success: false,
          error: `Bridge for ${orgName} not found`,
        });
      }

      if (!documentID) {
        return res.status(400).json({
          success: false,
          error: "documentID parameter is required",
        });
      }

      const orgConfig = config.getOrgConfig(orgName);
      const targetCollection = collectionLog || orgConfig.collections.logs;

      const result = await this.bridgeController
        .getBridge(orgName)
        .queryViaClient(
          "ReadAllLogsByDocumentIDWebhook",
          [targetCollection, documentID],
          userId
        );
      res.json(result);
    } catch (error) {
      console.error(`Error reading logs for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new LogController();
