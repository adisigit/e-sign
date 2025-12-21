const { Gateway, Wallets } = require('fabric-network');
const config = require('../config/fabric-config');
const { loadConnectionProfile } = require('../utils/connection-profile');

async function getGateway(userId, orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);
        const wallet = await Wallets.newFileSystemWallet(orgConfig.paths.wallet);
        const ccp = loadConnectionProfile(orgName);

        const userIdentity = await wallet.get(userId);
        if (!userIdentity) {
            throw new Error(`User ${userId} not found in wallet for ${orgConfig.name}. Please register the user first.`);
        }

        const gateway = new Gateway();
        await gateway.connect(ccp, {
            wallet,
            identity: userId,
            discovery: { enabled: true, asLocalhost: true }
        });

        return gateway;
    } catch (error) {
        console.error(`Error connecting to gateway with user ${userId} for ${orgName}:`, error);
        throw error;
    }
}

async function getContract(userId, orgName = 'org1') {
    try {
        const gateway = await getGateway(userId, orgName);
        const network = await gateway.getNetwork(config.channelName);
        const contract = network.getContract(config.chaincodeName);
        
        return { gateway, network, contract };
    } catch (error) {
        console.error(`Error getting contract for ${orgName}:`, error);
        throw error;
    }
}

async function submitTransaction(functionName, transientData, userId, orgName = 'org1', ...args) {
    let gateway;
    try {
        const { gateway: gw, contract } = await getContract(userId, orgName);
        gateway = gw;

        const transaction = contract.createTransaction(functionName);
        
        if (transientData) {
            transaction.setTransient(transientData);
        }

        const result = await transaction.submit(...args);
        
        return result;
    } catch (error) {
        console.error(`Error submitting transaction ${functionName} for ${orgName}:`, error);
        throw error;
    } finally {
        if (gateway) {
            await gateway.disconnect();
        }
    }
}

async function evaluateTransaction(functionName, userId, orgName = 'org1', ...args) {
    let gateway;
    try {
        const { gateway: gw, contract } = await getContract(userId, orgName);
        gateway = gw;

        const result = await contract.evaluateTransaction(functionName, ...args);
        
        return result;
    } catch (error) {
        console.error(`Error evaluating transaction ${functionName} for ${orgName}:`, error);
        throw error;
    } finally {
        if (gateway) {
            await gateway.disconnect();
        }
    }
}

async function createPrivateDocument(docData, userId, orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);
        console.log(userId);

        if (!docData.collection) {
            docData.collection = orgConfig.collections.documents;
        }

        const transientData = {
            doc: Buffer.from(JSON.stringify(docData))
        };

        await submitTransaction('CreatePrivateDocument', transientData, userId, orgName);
        
        return { 
            success: true, 
            message: `Document created successfully in ${orgConfig.name}`,
            data: { ...docData, organization: orgConfig.name }
        };
    } catch (error) {
        console.error(`Error creating private document for ${orgName}:`, error);
        throw error;
    }
}

async function createPrivateLogDocument(logData, userId, orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);

        if (!logData.collectionLog) {
            logData.collectionLog = orgConfig.collections.logs;
        }

        const transientData = {
            log: Buffer.from(JSON.stringify(logData))
        };

        await submitTransaction('CreatePrivateLogDocument', transientData, userId, orgName);
        
        return { 
            success: true, 
            message: `Log created successfully in ${orgConfig.name}`,
            data: { ...logData, organization: orgConfig.name }
        };
    } catch (error) {
        console.error(`Error creating private log document for ${orgName}:`, error);
        throw error;
    }
}

async function createPrivateLogDocumentWebhook(logData, userId, orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);

        if (!logData.collectionLog) {
            logData.collectionLog = orgConfig.collections.logs;
        }

        const transientData = {
            log: Buffer.from(JSON.stringify(logData))
        };

        await submitTransaction('CreatePrivateLogDocumentWebhook', transientData, userId, orgName);
        
        return { 
            success: true, 
            message: `Log webhook created successfully in ${orgConfig.name}`,
            data: { ...logData, organization: orgConfig.name }
        };
    } catch (error) {
        console.error(`Error creating private log document webhook for ${orgName}:`, error);
        throw error;
    }
}

async function readAllDocumentsByOrg(collection = null, userId, orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);

        const targetCollection = collection || orgConfig.collections.documents;

        const result = await evaluateTransaction('ReadAllDocumentByOrg', userId, orgName, targetCollection);
        const documents = JSON.parse(result.toString());
        
        return { 
            success: true, 
            data: documents.map(doc => ({ ...doc, organization: orgConfig.name }))
        };
    } catch (error) {
        console.error(`Error reading documents by org for ${orgName}:`, error);
        throw error;
    }
}

async function readAllLogsByDocumentID(collectionLog = null, documentID, userId, orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);
        const targetCollection = collectionLog || orgConfig.collections.logs;

        const result = await evaluateTransaction('ReadAllLogByDocumentID', userId, orgName, targetCollection, documentID);
        const logs = JSON.parse(result.toString());
        
        return { 
            success: true, 
            data: logs.map(log => ({ ...log, organization: orgConfig.name }))
        };
    } catch (error) {
        console.error(`Error reading logs by document ID for ${orgName}:`, error);
        throw error;
    }
}

async function readAllLogsByDocumentIDWebhook(collectionLog = null, documentID, userId, orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);
        const targetCollection = collectionLog || orgConfig.collections.logs;

        const result = await evaluateTransaction('ReadAllLogByDocumentIDWebhook', userId, orgName, targetCollection, documentID);
        const logs = JSON.parse(result.toString());
        
        return { 
            success: true, 
            data: logs.map(log => ({ ...log, organization: orgConfig.name }))
        };
    } catch (error) {
        console.error(`Error reading logs by document ID webhook for ${orgName}:`, error);
        throw error;
    }
}

async function testNetworkConnectivity(userId = 'admin', orgName = 'org1') {
    let gateway;
    try {
        const orgConfig = config.getOrgConfig(orgName);
        gateway = await getGateway(userId, orgName);
        const network = await gateway.getNetwork(config.channelName);
        const contract = network.getContract(config.chaincodeName);
        
        await contract.evaluateTransaction('org.hyperledger.fabric:GetMetadata');
        
        return {
            success: true,
            message: `Network connectivity test passed for ${orgConfig.name}`,
            data: {
                channelName: config.channelName,
                chaincodeName: config.chaincodeName,
                userId,
                organization: orgConfig.name,
                mspId: orgConfig.mspId
            }
        };
    } catch (error) {
        console.error(`Network connectivity test failed for ${orgName}:`, error);
        throw error;
    } finally {
        if (gateway) {
            await gateway.disconnect();
        }
    }
}

async function testAllOrgsConnectivity(userId = 'admin') {
    try {
        const results = {};
        const orgs = config.getAllOrgs();
        
        for (const orgName of orgs) {
            try {
                console.log(`Testing connectivity for ${orgName}...`);
                results[orgName] = await testNetworkConnectivity(userId, orgName);
            } catch (error) {
                console.error(`Connectivity test failed for ${orgName}:`, error.message);
                results[orgName] = { success: false, error: error.message };
            }
        }
        
        return { success: true, data: results };
    } catch (error) {
        console.error('Error testing connectivity for all organizations:', error);
        throw error;
    }
}

module.exports = {
    getGateway,
    getContract,
    submitTransaction,
    evaluateTransaction,
    createPrivateDocument,
    createPrivateLogDocument,
    createPrivateLogDocumentWebhook,
    readAllDocumentsByOrg,
    readAllLogsByDocumentID,
    readAllLogsByDocumentIDWebhook,
    testNetworkConnectivity,
    testAllOrgsConnectivity
};