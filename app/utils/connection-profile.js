const fs = require("fs");
const path = require("path");
const config = require("../config/fabric-config");

/**
 * Create connection profile for specified organization
 */
async function createConnectionProfile(orgName = "org1") {
  try {
    const orgConfig = config.getOrgConfig(orgName);

    // Read TLS certificates
    const peer0TLS = fs.readFileSync(
      orgConfig.paths.certificates.peer0TLS,
      "utf8"
    );
    const peer1TLS = fs.readFileSync(
      orgConfig.paths.certificates.peer1TLS,
      "utf8"
    );
    const caTLS = fs.readFileSync(orgConfig.paths.certificates.caTLS, "utf8");

    const connectionProfile = {
      name: `fabric-network-${orgName}`,
      version: "1.0.0",
      client: {
        organization: orgConfig.name,
        connection: {
          timeout: config.timeout,
        },
      },
      organizations: {
        [orgConfig.name]: {
          mspid: orgConfig.mspId,
          peers: [
            orgConfig.endpoints.peers.peer0.hostname,
            orgConfig.endpoints.peers.peer1.hostname,
          ],
          certificateAuthorities: [`ca.${orgConfig.domain}`],
        },
      },
      peers: {
        [orgConfig.endpoints.peers.peer0.hostname]: {
          url: orgConfig.endpoints.peers.peer0.url,
          tlsCACerts: {
            pem: peer0TLS,
          },
          grpcOptions: {
            "ssl-target-name-override":
              orgConfig.endpoints.peers.peer0.hostname,
            hostnameOverride: orgConfig.endpoints.peers.peer0.hostname,
          },
        },
        [orgConfig.endpoints.peers.peer1.hostname]: {
          url: orgConfig.endpoints.peers.peer1.url,
          tlsCACerts: {
            pem: peer1TLS,
          },
          grpcOptions: {
            "ssl-target-name-override":
              orgConfig.endpoints.peers.peer1.hostname,
            hostnameOverride: orgConfig.endpoints.peers.peer1.hostname,
          },
        },
      },
      certificateAuthorities: {
        [`ca.${orgConfig.domain}`]: {
          url: orgConfig.endpoints.ca.url,
          caName: orgConfig.endpoints.ca.name,
          tlsCACerts: {
            pem: caTLS,
          },
          httpOptions: {
            verify: false,
          },
        },
      },
    };

    // Ensure directory exists
    const orgDir = path.dirname(orgConfig.paths.connectionProfile);
    if (!fs.existsSync(orgDir)) {
      fs.mkdirSync(orgDir, { recursive: true });
    }

    // Write connection profile
    fs.writeFileSync(
      orgConfig.paths.connectionProfile,
      JSON.stringify(connectionProfile, null, 2)
    );
    console.log(
      `Connection profile created for ${orgConfig.name} at:`,
      orgConfig.paths.connectionProfile
    );

    return {
      ...connectionProfile,
      peers: Object.fromEntries(
        Object.entries(connectionProfile.peers).map(([key, value]) => [
          key,
          { ...value, tlsCACerts: "[HIDDEN]" },
        ])
      ),
      certificateAuthorities: Object.fromEntries(
        Object.entries(connectionProfile.certificateAuthorities).map(
          ([key, value]) => [key, { ...value, tlsCACerts: "[HIDDEN]" }]
        )
      ),
    };
  } catch (error) {
    console.error(`Error creating connection profile for ${orgName}:`, error);
    throw error;
  }
}

/**
 * Load existing connection profile for specified organization
 */
function loadConnectionProfile(orgName = "org1") {
  try {
    const orgConfig = config.getOrgConfig(orgName);

    if (!fs.existsSync(orgConfig.paths.connectionProfile)) {
      throw new Error(
        `Connection profile for ${orgConfig.name} not found. Please run POST /api/init/${orgName} first to create it.`
      );
    }

    return JSON.parse(
      fs.readFileSync(orgConfig.paths.connectionProfile, "utf8")
    );
  } catch (error) {
    if (error.message.includes("no such file")) {
      const orgConfig = config.getOrgConfig(orgName);
      throw new Error(
        `Connection profile for ${orgConfig.name} not found. Please run POST /api/init/${orgName} first to create it.`
      );
    }
    console.error(`Error loading connection profile for ${orgName}:`, error);
    throw error;
  }
}

/**
 * Create connection profiles for all organizations
 */
async function createAllConnectionProfiles() {
  const results = {};
  const orgs = config.getAllOrgs();

  for (const orgName of orgs) {
    try {
      console.log(`Creating connection profile for ${orgName}...`);
      results[orgName] = await createConnectionProfile(orgName);
    } catch (error) {
      console.error(
        `Failed to create connection profile for ${orgName}:`,
        error.message
      );
      results[orgName] = { error: error.message };
    }
  }

  return results;
}

/**
 * Check if connection profile exists for organization
 */
function connectionProfileExists(orgName = "org1") {
  try {
    const orgConfig = config.getOrgConfig(orgName);
    return fs.existsSync(orgConfig.paths.connectionProfile);
  } catch (error) {
    return false;
  }
}

module.exports = {
  createConnectionProfile,
  loadConnectionProfile,
  createAllConnectionProfiles,
  connectionProfileExists,
};
