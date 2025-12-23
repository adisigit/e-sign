const BridgeController = require("../controllers/bridge-controller");
const config = require("../config/fabric-config");

class DocumentController {
  constructor() {
    this.bridgeController = BridgeController;
  }

  async createPrivateDocument(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const {
        collection,
        documentID,
        documentName,
        status,
      } = req.body;

      const userId = req.walletUserId;
      const ownerID = req.user.userId;
      const ownerName = req.user.name;

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

      if (!documentID || !documentName || !ownerID || !ownerName) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: documentID, documentName, ownerID, ownerName",
        });
      }

      const orgConfig = config.getOrgConfig(orgName);

      const targetCollection = collection || orgConfig.collections.documents;

      const result = await this.bridgeController.getBridge(orgName).invokeViaClient(
        "CreatePrivateDocument",
        [
          targetCollection,
          documentID,
          documentName,
          ownerID,
          ownerName,
          status,
          userId
        ],
        null,
      );

      res.json(result);
    } catch (error) {
      console.error(`Error creating document for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getDocumentsByOrg(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { collection } = req.query;
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

      const orgConfig = config.getOrgConfig(orgName);
      const targetCollection = collection || orgConfig.collections.documents;

      const result = await this.bridgeController.getBridge(orgName).queryViaClient(
        "ReadAllDocumentsByOrg",
        [targetCollection],
        userId
      );

      res.json(result);
    } catch (error) {
      console.error(`Error reading documents for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async readAllDocumentByOrgWithIntegrityCheck(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { collection } = req.query;
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

      const orgConfig = config.getOrgConfig(orgName);
      const targetCollection = collection || orgConfig.collections.documents;

      const result = await this.bridgeController.getBridge(orgName).queryViaClient(
        "ReadAllDocumentByOrgWithIntegrityCheck",
        [targetCollection],
        userId,
        orgName
      );

      res.json(result);
    } catch (error) {
      console.error(`Error reading all documents by org with integrity check for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async verifyPrivateDataIntegrity(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { collection } = req.query;
      const { documentID } = req.params;
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

      const orgConfig = config.getOrgConfig(orgName);
      const targetCollection = collection || orgConfig.collections.documents;

      const result = await this.bridgeController.getBridge(orgName).queryViaClient(
        "VerifyPrivateDataIntegrity",
        [targetCollection, documentID],
        userId,
        orgName
      );

      res.json(result);
    } catch (error) {
      console.error(`Error verifying private data integrity for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async verifyAllDocumentsIntegrity(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const { collection } = req.query;
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

      const orgConfig = config.getOrgConfig(orgName);
      const targetCollection = collection || orgConfig.collections.documents;

      const result = await this.bridgeController.getBridge(orgName).queryViaClient(
        "VerifyAllDocumentsIntegrity",
        [targetCollection],
        userId,
        orgName
      );

      res.json(result);
    } catch (error) {
      console.error(`Error verifying all documents integrity for ${orgName}:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new DocumentController();