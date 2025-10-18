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
        ownerID,
        ownerName,
        status,
        userId = "admin",
      } = req.body;

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
    try {
      const { orgName = "org1" } = req.params;
      const { collection, userId = "admin" } = req.query;

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
}

module.exports = new DocumentController();