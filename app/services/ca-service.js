const { Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const config = require('../config/fabric-config');
const { loadConnectionProfile } = require('../utils/connection-profile');

async function enrollAdmin(orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);
        
        // Create a new file system based wallet for managing identities
        const wallet = await Wallets.newFileSystemWallet(orgConfig.paths.wallet);

        // Check to see if we've already enrolled the admin user
        const adminIdentity = await wallet.get('admin');
        if (adminIdentity) {
            console.log(`An identity for the admin user "admin" already exists in the wallet for ${orgConfig.name}`);
            return { success: true, message: 'Admin already enrolled' };
        }

        // Load connection profile
        const ccp = loadConnectionProfile(orgName);

        // Create a new CA client for interacting with the CA
        const caInfo = ccp.certificateAuthorities[`ca.${orgConfig.domain}`];
        const caTLSCACerts = caInfo.tlsCACerts.pem;
        const ca = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);

        // Enroll the admin user
        const enrollment = await ca.enroll({ 
            enrollmentID: config.caAdmin.enrollmentID, 
            enrollmentSecret: config.caAdmin.enrollmentSecret 
        });
        
        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: orgConfig.mspId,
            type: 'X.509',
        };
        
        await wallet.put('admin', x509Identity);
        console.log(`Successfully enrolled admin user "admin" and imported it into the wallet for ${orgConfig.name}`);
        
        return { success: true, message: `Admin enrolled successfully for ${orgConfig.name}` };

    } catch (error) {
        console.error(`Failed to enroll admin user "admin" for ${orgName}: ${error}`);
        throw error;
    }
}

async function registerUser(userId, orgName = 'org1', affiliation = null) {
    try {
        const orgConfig = config.getOrgConfig(orgName);
        const defaultAffiliation = `${orgName}.department1`;
        
        const wallet = await Wallets.newFileSystemWallet(orgConfig.paths.wallet);

        // Check if user already exists
        const userIdentity = await wallet.get(userId);
        if (userIdentity) {
            console.log(`An identity for the user "${userId}" already exists in the wallet for ${orgConfig.name}`);
            return { success: true, message: `User ${userId} already exists in ${orgConfig.name}` };
        }

        // Check if admin exists
        const adminIdentity = await wallet.get('admin');
        if (!adminIdentity) {
            throw new Error(`An identity for the admin user "admin" does not exist in the wallet for ${orgConfig.name}. Run /api/init/${orgName} first.`);
        }

        // Load connection profile
        const ccp = loadConnectionProfile(orgName);

        // Create a new CA client
        const caInfo = ccp.certificateAuthorities[`ca.${orgConfig.domain}`];
        const caTLSCACerts = caInfo.tlsCACerts.pem;
        const ca = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        // Register the user
        const secret = await ca.register({
            affiliation: affiliation || defaultAffiliation,
            enrollmentID: userId,
            role: 'client'
        }, adminUser);

        // Enroll the user
        const enrollment = await ca.enroll({
            enrollmentID: userId,
            enrollmentSecret: secret
        });

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: orgConfig.mspId,
            type: 'X.509',
        };

        await wallet.put(userId, x509Identity);
        console.log(`Successfully registered and enrolled user "${userId}" and imported it into the wallet for ${orgConfig.name}`);

        return { success: true, message: `User ${userId} registered successfully in ${orgConfig.name}` };

    } catch (error) {
        console.error(`Failed to register user "${userId}" for ${orgName}: ${error}`);
        throw error;
    }
}

async function getAllUsers(orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);
        const wallet = await Wallets.newFileSystemWallet(orgConfig.paths.wallet);
        const identityLabels = await wallet.list();
        
        const users = identityLabels.map(label => ({
            userId: label,
            type: 'X.509',
            organization: orgConfig.name
        }));

        return { success: true, data: users };
    } catch (error) {
        console.error(`Error getting users for ${orgName}:`, error);
        throw error;
    }
}

async function userExists(userId, orgName = 'org1') {
    try {
        const orgConfig = config.getOrgConfig(orgName);
        const wallet = await Wallets.newFileSystemWallet(orgConfig.paths.wallet);
        const identity = await wallet.get(userId);
        return !!identity;
    } catch (error) {
        console.error(`Error checking user ${userId} for ${orgName}:`, error);
        return false;
    }
}

async function enrollAllAdmins() {
    try {
        const results = {};
        const orgs = config.getAllOrgs();
        
        for (const orgName of orgs) {
            try {
                console.log(`Enrolling admin for ${orgName}...`);
                results[orgName] = await enrollAdmin(orgName);
            } catch (error) {
                console.error(`Failed to enroll admin for ${orgName}:`, error.message);
                results[orgName] = { success: false, error: error.message };
            }
        }
        
        return { success: true, data: results };
    } catch (error) {
        console.error('Error enrolling admins for all organizations:', error);
        throw error;
    }
}

module.exports = {
    enrollAdmin,
    registerUser,
    getAllUsers,
    userExists,
    enrollAllAdmins
};