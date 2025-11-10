const fabricNatsBridge = require("../services/fabric-nats-bridge");
const config = require("../config/fabric-config");

class BridgeController {
  constructor() {
    this.bridges = {};
  }

  async initialize() {
    try {
      console.log("Initializing Fabric-NATS Bridges for all organizations...");
      const orgs = config.getAllOrgs();

      for (const orgName of orgs) {
        console.log(`Setting up bridge for ${orgName}...`);
        this.bridges[orgName] = new fabricNatsBridge(orgName);
        await this.bridges[orgName].initialize();
        // await this.bridges[orgName].setupBlockListener();
        console.log(`Bridge for ${orgName} initialized successfully`);
      }
      console.log("All bridges initialized successfully");
    } catch (error) {
      console.error("Failed to initialize bridges:", error);
      throw error;
    }
  }

  getBridge(orgName) {
    return this.bridges[orgName];
  }

  async close() {
    try {
      console.log("Closing all Fabric-NATS Bridges...");

      const orgNames = Object.keys(this.bridges);

      for (const orgName of orgNames) {
        const bridge = this.bridges[orgName];
        if (bridge) {
          console.log(`Closing bridge for ${orgName}...`);
          await bridge.close();
          console.log(`Bridge for ${orgName} closed successfully.`);
        }
      }

      console.log("All bridges closed successfully.");
    } catch (error) {
      console.error("Error closing bridges:", error);
      throw error;
    }
  }
}

module.exports = new BridgeController();
