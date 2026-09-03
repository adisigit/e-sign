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
        recipients = [],
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

      if (!id || !documentCategoryCode || !name || !description || !file) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: documentID, documentCategoryCode, name, description, file, recipients",
        });
      }

      const orgConfig = config.getOrgConfig(orgName);

      const targetCollection = orgConfig.collections.documents;

      const requestId = `${orgName}_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      this.bridgeController
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
          requestId,
          null,
        );
      res.status(200).json({
        success: true,
        message: "Webhook queued for processing",
        requestId: requestId,
        statusUrl: `/api/webhook/status/${orgName}/${requestId}`,
        data: {
          id,
          documentCategoryCode,
          name,
          collection: targetCollection,
        },
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
          userId,
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
          orgName,
        );

      res.json(result);
    } catch (error) {
      console.error(
        `Error reading all documents by org with integrity check for ${orgName}:`,
        error,
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
          orgName,
        );

      res.json(result);
    } catch (error) {
      console.error(
        `Error reading all documents by org with integrity check for ${orgName}:`,
        error,
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
          userId,
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

  async verifyDocumentShortCircuit(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { id, file } = req.body;
      const documentID = id;
      const userId = "admin";
      const orgUser = req.user.organizations[0];

      if (!id || !file) {
        return res.status(400).json({
          success: false,
          error: "Both 'id' and 'file' (base64) are required in the request body",
        });
      }

      const fileBuffer = Buffer.from(file, "base64");
      const presentedDocHashHex = crypto
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

      const startedAt = process.hrtime.bigint();

      const result = await this.bridgeController
        .getBridge(orgUser)
        .queryViaClient(
          "VerifyDocumentShortCircuit",
          [targetCollection, documentID, presentedDocHashHex],
          userId,
        );

      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      const layer1FailureStatuses = new Set([
        "PDC_RECORD_SCHEMA_VIOLATION",
        "PDC_RECORD_CANONICALIZATION_FAILURE",
        "PDC_RECORD_COMPROMISED",
      ]);

      res.json({
        ...result,
        _meta: {
          elapsedMs,
          shortCircuited: layer1FailureStatuses.has(result.status),
        },
      });
    } catch (error) {
      console.error(
        `Error in verifyDocumentShortCircuit for ${orgName}:`,
        error,
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async verifyAblationVariant(req, res) {
    const { orgName = "org1", variant } = req.params;
    const { id, file } = req.body;
    const userId = "admin";
    if (!["V0", "V1", "V2", "V3", "V4"].includes(variant)) {
      return res.status(400).json({
        success: false,
        error: `Invalid variant: ${variant}`,
      });
    }
    const orgConfig = config.getOrgConfig(orgName);
    const targetCollection = orgConfig.collections.documents;

    const totalStartedAt = process.hrtime.bigint();
    const fileBuffer = Buffer.from(file, "base64");
    const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const queryStartedAt = process.hrtime.bigint();

    const result = await this.bridgeController
      .getBridge(orgName)
      .queryViaClient(
        "VerifyAblationVariant",
        [targetCollection, id, fileHash, variant],
        userId
      );

    const queryElapsedMs = Number(process.hrtime.bigint() - queryStartedAt) / 1e6;
    const totalElapsedMs = Number(process.hrtime.bigint() - totalStartedAt) / 1e6;

    res.json({
      ...result,
      _meta: {
        variant,
        queryElapsedMs,
        totalElapsedMs,
      },
    });
  }
}

module.exports = new WebhookController();
