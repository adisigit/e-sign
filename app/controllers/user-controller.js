const caService = require('../services/ca-service');
const fabricService = require('../services/fabric-service');
const { createConnectionProfile, createAllConnectionProfiles } = require('../utils/connection-profile');
const config = require('../config/fabric-config');

async function initializeNetworkOrg(req, res) {
    try {
        const { orgName = 'org1' } = req.params;
        
        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        // Create connection profile
        await createConnectionProfile(orgName);
        
        // Enroll admin user
        const adminResult = await caService.enrollAdmin(orgName);
        
        res.json({
            success: true,
            message: `Network initialized successfully for ${orgName}`,
            data: {
                organization: orgName,
                connectionProfile: 'Created',
                admin: adminResult.message
            }
        });
    } catch (error) {
        console.error(`Error initializing network for ${req.params.orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function initializeAllNetworks(req, res) {
    try {
        // Create connection profiles for all orgs
        const connectionResults = await createAllConnectionProfiles();
        
        // Enroll admin users for all orgs
        const adminResults = await caService.enrollAllAdmins();
        
        res.json({
            success: true,
            message: 'All networks initialized successfully',
            data: {
                connectionProfiles: connectionResults,
                adminEnrollments: adminResults.data
            }
        });
    } catch (error) {
        console.error('Error initializing all networks:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function registerUserOrg(req, res) {
    try {
        const { orgName = 'org1' } = req.params;
        const { userId, affiliation } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required'
            });
        }

        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        const result = await caService.registerUser(userId, orgName, affiliation);
        
        res.json(result);
    } catch (error) {
        console.error(`Error registering user for ${req.params.orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function getUsersByOrg(req, res) {
    try {
        const { orgName = 'org1' } = req.params;
        
        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        const result = await caService.getAllUsers(orgName);
        res.json(result);
    } catch (error) {
        console.error(`Error getting users for ${req.params.orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function checkUserExistsOrg(req, res) {
    try {
        const { userId, orgName = 'org1' } = req.params;
        
        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        const exists = await caService.userExists(userId, orgName);
        
        res.json({
            success: true,
            data: {
                userId,
                organization: orgName,
                exists
            }
        });
    } catch (error) {
        console.error(`Error checking user for ${req.params.orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function testNetworkConnectivityOrg(req, res) {
    try {
        const { orgName = 'org1' } = req.params;
        const { userId = 'admin' } = req.query;
        
        if (!config.organizations[orgName]) {
            return res.status(400).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        const result = await fabricService.testNetworkConnectivity(userId, orgName);
        res.json(result);
    } catch (error) {
        console.error(`Error testing network connectivity for ${req.params.orgName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function testAllNetworkConnectivity(req, res) {
    try {
        const { userId = 'admin' } = req.query;
        const result = await fabricService.testAllOrgsConnectivity(userId);
        res.json(result);
    } catch (error) {
        console.error('Error testing network connectivity for all organizations:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function getOrgInfo(req, res) {
    try {
        const { orgName } = req.params;
        
        if (orgName && !config.organizations[orgName]) {
            return res.status(404).json({
                success: false,
                error: `Organization ${orgName} not found`,
                availableOrgs: config.getAllOrgs()
            });
        }

        if (orgName) {
            const orgConfig = config.getOrgConfig(orgName);
            res.json({
                success: true,
                data: {
                    name: orgConfig.name,
                    mspId: orgConfig.mspId,
                    domain: orgConfig.domain,
                    collections: orgConfig.collections,
                    endpoints: orgConfig.endpoints
                }
            });
        } else {
            // Return all organizations info
            const allOrgs = {};
            config.getAllOrgs().forEach(org => {
                const orgConfig = config.getOrgConfig(org);
                allOrgs[org] = {
                    name: orgConfig.name,
                    mspId: orgConfig.mspId,
                    domain: orgConfig.domain,
                    collections: orgConfig.collections,
                    endpoints: orgConfig.endpoints
                };
            });
            
            res.json({
                success: true,
                data: allOrgs
            });
        }
    } catch (error) {
        console.error('Error getting organization info:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    // Multi-org functions
    initializeNetworkOrg,
    initializeAllNetworks,
    registerUserOrg,
    getUsersByOrg,
    checkUserExistsOrg,
    testNetworkConnectivityOrg,
    testAllNetworkConnectivity,
    getOrgInfo,
};