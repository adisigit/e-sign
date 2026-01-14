const BridgeController = require("../controllers/bridge-controller");
const config = require("../config/fabric-config");
const crypto = require("crypto");

class WebhookController {
  constructor() {
    this.bridgeController = BridgeController;
  }

  async createWebhook(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const {
        id,
        documentCategoryCode,
        name,
        description,
        file,
        recipients,
        userId = "admin",
      } = req.body;
      const fileBuffer = Buffer.from(file, "base64");
      const fileHash = crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");

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

      if (
        !id ||
        !documentCategoryCode ||
        !name ||
        !description ||
        !file ||
        !recipients
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: documentID, documentCategoryCode, name, description, file, recipients",
        });
      }

      const orgConfig = config.getOrgConfig(orgName);

      const targetCollection = orgConfig.collections.documents;

      const result = await this.bridgeController
        .getBridge(orgName)
        .invokeViaClient(
          "CreatePrivateDataWebhook",
          [
            targetCollection,
            id,
            documentCategoryCode,
            name,
            description,
            fileHash,
            recipients,
            userId,
          ],
          null
        );
      res.status(202).json({
        success: true,
        message: "Webhook queued for processing",
        requestId: result.requestId,
        statusUrl: `/api/${orgName}/webhook/status/${result.requestId}`,
        data: result.data,
      });
    } catch (error) {
      console.error(`Error creating webhook for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getWebhookStatus(req, res) {
    const { orgName = "org1", requestId } = req.params;

    try {
      const bridge = this.bridgeController.getBridge(orgName);

      if (!bridge) {
        return res.status(500).json({
          success: false,
          error: `Bridge for ${orgName} not found`,
        });
      }

      const status = await bridge.getWebhookStatus(requestId);

      return res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getLogsByDocumentIdWebhook(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { documentID } = req.params;
      const userId = "admin";
      const orgUser = req.user.organizations[0];

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
      const targetCollection = orgConfig.collections.logs;

      const result = await this.bridgeController
        .getBridge(orgUser)
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

  async readDocumentByIDWithIntegrityCheckWebhook(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { documentID } = req.params;
      const userId = "admin";
      const orgUser = req.user.organizations[0];

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

      const orgConfig = config.getOrgConfig(orgName);

      const targetCollection = orgConfig.collections.documents;

      const result = await this.bridgeController
        .getBridge(orgUser)
        .queryViaClient(
          "ReadDocumentByIDWithIntegrityCheckWebhook",
          [targetCollection, documentID],
          userId,
          orgName
        );

      res.json(result);
    } catch (error) {
      console.error(
        `Error reading all documents by org with integrity check for ${orgName}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async readAllLogByDocumentIDWithIntegrityCheck(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { documentID } = req.params;
      const userId = "admin";
      const orgUser = req.user.organizations[0];

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

      const orgConfig = config.getOrgConfig(orgName);
      const targetCollection = orgConfig.collections.logs;

      const result = await this.bridgeController
        .getBridge(orgUser)
        .queryViaClient(
          "ReadAllLogByDocumentIDWithIntegrityCheck",
          [targetCollection, documentID],
          userId,
          orgName
        );

      res.json(result);
    } catch (error) {
      console.error(
        `Error reading all documents by org with integrity check for ${orgName}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async checkDocumentIntegrityWebhook(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { id, file } = req.body;
      const documentID = id;
      const userId = "admin";
      const orgUser = req.user.organizations[0];
      const fileBuffer = Buffer.from(file, "base64");
      const fileHash = crypto
        .createHash("sha256")
        .update(fileBuffer)
        .digest("hex");

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

      const orgConfig = config.getOrgConfig(orgName);
      const targetCollection = orgConfig.collections.documents;

      const result = await this.bridgeController
        .getBridge(orgUser)
        .queryViaClient(
          "CheckDocumentIntegrityWebhook",
          [targetCollection, documentID, fileHash],
          userId
        );

      res.json(result);
    } catch (error) {
      console.error(`Error checking document integrity for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new WebhookController();
