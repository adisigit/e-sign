const fabricService = require('../services/fabric-service');
const config = require('../config/fabric-config');

async function createPrivateDocumentOrg(req, res) {
    try {
        const { orgName = 'org1' } = req.params;
        const { collection, documentID, documentName, ownerID, ownerName, status, userId = 'admin' } = req.body;

        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        // Validate required fields
        if (!documentID || !documentName || !ownerID || !ownerName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: documentID, documentName, ownerID, ownerName'
            });
        }

        const orgConfig = config.getOrgConfig(orgName);

        // Prepare document data
        const docData = {
            collection: collection || orgConfig.collections.documents,
            documentID,
            documentName,
            ownerID,
            ownerName,
            status: status || 'OPEN'
        };

        const result = await fabricService.createPrivateDocument(docData, userId, orgName);
        res.json(result);

    } catch (error) {
        console.error(`Error creating document for ${orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function getDocumentsByOrg(req, res) {
    try {
        const { orgName = 'org1' } = req.params;
        const { collection, userId = 'admin' } = req.query;

        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        const orgConfig = config.getOrgConfig(orgName);
        const targetCollection = collection || orgConfig.collections.documents;

        const result = await fabricService.readAllDocumentsByOrg(targetCollection, userId, orgName);
        res.json(result);

    } catch (error) {
        console.error(`Error reading documents for ${orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    createPrivateDocumentOrg,
    getDocumentsByOrg,
};