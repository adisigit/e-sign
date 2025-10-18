const BridgeController = require("../controllers/bridge-controller");
const config = require("../config/fabric-config");

class LogController {
  constructor() {
    this.bridgeController = BridgeController;
  }

  async createPrivateLogDocumentOrg(req, res) {
    const { orgName = "org1" } = req.params;
    try {
      const {
        collectionLog,
        documentID,
        actorID,
        actorName,
        action,
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

      if (!documentID || !actorID || !actorName || !action) {
        return res.status(400).json({
          success: false,
          error:
            "Missing required fields: documentID, actorID, actorName, action",
        });
      }

      const orgConfig = config.getOrgConfig(orgName);

      const targetCollection = collectionLog || orgConfig.collections.logs;

      const result = await this.bridgeController.getBridge(orgName).invokeViaClient(
        "CreatePrivateLogDocument",
        [targetCollection, documentID, actorID, actorName, action],
        null,
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
        const { orgName = 'org1', documentID } = req.params;
        const { collectionLog, userId = 'admin' } = req.query;

        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
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
                error: 'documentID parameter is required'
            });
        }

        const orgConfig = config.getOrgConfig(orgName);
        const targetCollection = collectionLog || orgConfig.collections.logs;

        const result = await this.bridgeController.getBridge(orgName).queryViaClient(
            "ReadAllLogsByDocumentID",
            [targetCollection, documentID],
            userId
          );
        res.json(result);

    } catch (error) {
        console.error(`Error reading logs for ${orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
  }
}

module.exports = new LogController();