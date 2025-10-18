const fabricService = require('../services/fabric-service');
const config = require('../config/fabric-config');

async function createPrivateLogDocumentOrg(req, res) {
    try {
        const { orgName = 'org1' } = req.params;
        const { collectionLog, documentID, actorID, actorName, action, userId = 'admin' } = req.body;

        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        // Validate required fields
        if (!documentID || !actorID || !actorName || !action) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: documentID, actorID, actorName, action'
            });
        }

        const orgConfig = config.getOrgConfig(orgName);

        // Prepare log data
        const logData = {
            collectionLog: collectionLog || orgConfig.collections.logs,
            documentID,
            actorID,
            actorName,
            action
        };

        const result = await fabricService.createPrivateLogDocument(logData, userId, orgName);
        res.json(result);

    } catch (error) {
        console.error(`Error creating log for ${orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function getLogsByDocumentId(req, res) {
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

        if (!documentID) {
            return res.status(400).json({
                success: false,
                error: 'documentID parameter is required'
            });
        }

        const orgConfig = config.getOrgConfig(orgName);
        const targetCollection = collectionLog || orgConfig.collections.logs;

        const result = await fabricService.readAllLogsByDocumentID(targetCollection, documentID, userId, orgName);
        res.json(result);

    } catch (error) {
        console.error(`Error reading logs for ${orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    createPrivateLogDocumentOrg,
    getLogsByDocumentId,
};