const express = require("express");
const cors = require("cors");
const config = require("./config/fabric-config");
const { verifyToken, validateOrgAccess } = require("./middlewares/auth");

// Import controllers
const bridgeController = require("./controllers/bridge-controller");
const userController = require("./controllers/user-controller");
const webhookController = require("./controllers/webhok-controller-nats");

// Import middlewares
const {
  errorHandler,
  notFoundHandler,
  asyncHandler,
} = require("./middlewares/error-handler");

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Fabric E-Sign API (Multi-Org)",
    version: "2.0.0",
  });
});

// API Information endpoint
app.get("/api", (req, res) => {
  res.json({
    service: "Hyperledger Fabric E-Sign API (Multi-Organization Support)",
    version: "2.0.0",
    organizations: config.getAllOrgs().map((orgName) => {
      const orgConfig = config.getOrgConfig(orgName);
      return {
        name: orgConfig.name,
        mspId: orgConfig.mspId,
        domain: orgConfig.domain,
        collections: orgConfig.collections,
      };
    }),
    endpoints: {
      system: {
        "GET /health": "Health check",
        "GET /api": "API information",
        "GET /api/orgs": "Get all organizations info",
        "GET /api/orgs/:orgName": "Get specific organization info",
      },
      initialization: {
        "POST /api/init": "Initialize all networks",
        "POST /api/init/:orgName": "Initialize specific organization network",
        "GET /api/network/test": "Test all networks connectivity",
        "GET /api/network/test/:orgName": "Test specific network connectivity",
      },
      users: {
        "POST /api/users/register/:orgName":
          "Register user in specific organization",
        "GET /api/users/:orgName": "Get users from specific organization",
        "GET /api/users/:userId/exists/:orgName":
          "Check if user exists in specific organization",
      },
      webhook: {
        "POST /api/webhook/:orgName":
          "Create document and log in specific organization",
        "GET /api/logs/webhook/org/:orgName/:documentID":
          "Get log from specific organization and document id",
        "GET /api/document/webhook/org/:orgName/integrity/:documentID":
          "Get integrity of specific document from specific organization",
        "GET /api/logs/webhook/org/:orgName/integrity/:documentID":
          "Get integrity of logs from specific organization and document id",
        "GET /api/webhook/status/:orgName/:requestId":
          "Get status of specific webhook request from specific organization",
        "POST /api/document/webhook/:orgName/integrity":
          "Check integrity of specific document from specific organization",
      },
    },
    fabric: {
      channelName: config.channelName,
      chaincodeName: config.chaincodeName,
      defaultOrg: config.defaultOrg,
    },
  });
});

app.get("/api/orgs", verifyToken, asyncHandler(userController.getOrgInfo));

app.get(
  "/api/orgs/:orgName",
  verifyToken,
  validateOrgAccess,
  asyncHandler(userController.getOrgInfo)
);

app.post(
  "/api/init",
  verifyToken,
  asyncHandler(userController.initializeAllNetworks)
);

app.post(
  "/api/init/:orgName",
  verifyToken,
  validateOrgAccess,
  asyncHandler(userController.initializeNetworkOrg)
);

app.get(
  "/api/network/test",
  verifyToken,
  asyncHandler(userController.testAllNetworkConnectivity)
);

app.get(
  "/api/network/test/:orgName",
  verifyToken,
  validateOrgAccess,
  asyncHandler(userController.testNetworkConnectivityOrg)
);

app.post(
  "/api/users/register/:orgName",
  verifyToken,
  validateOrgAccess,
  asyncHandler(userController.registerUserOrg)
);
app.get(
  "/api/users/:orgName",
  verifyToken,
  validateOrgAccess,
  asyncHandler(userController.getUsersByOrg)
);
app.get(
  "/api/users/:userId/exists/:orgName",
  verifyToken,
  validateOrgAccess,
  asyncHandler(userController.checkUserExistsOrg)
);

// app.get(
//   "/api/logs/org/:orgName/:documentID",
//   verifyToken,
//   validateOrgAccess,
//   logController.getLogsByDocumentId.bind(logController)
// );


app.post(
  "/api/webhook/:orgName",
  webhookController.createWebhook.bind(webhookController)
);
app.get(
  "/api/logs/webhook/org/:orgName/:documentID",
  verifyToken,
  webhookController.getLogsByDocumentIdWebhook.bind(webhookController)
);
app.get(
  "/api/document/webhook/org/:orgName/integrity/:documentID",
  verifyToken,
  webhookController.readDocumentByIDWithIntegrityCheckWebhook.bind(webhookController)
);
app.get(
  "/api/logs/webhook/org/:orgName/integrity/:documentID",
  verifyToken,
  webhookController.readAllLogByDocumentIDWithIntegrityCheck.bind(webhookController)
);
app.get(
  "/api/webhook/status/:orgName/:requestId",
  verifyToken,
  validateOrgAccess,
  webhookController.getWebhookStatus.bind(webhookController)
);
app.post(
  "/api/document/webhook/:orgName/integrity",
  verifyToken,
  webhookController.checkDocumentIntegrityWebhook.bind(webhookController)
);

app.use(notFoundHandler);

app.use(errorHandler);

let server;

async function gracefulShutdown(signal) {
  console.log(`\n\n${"=".repeat(80)}`);
  console.log(`${signal} received - Starting graceful shutdown...`);
  console.log("=".repeat(80) + "\n");

  try {
    console.log("Closing NATS bridges...");
    await bridgeController.close();

    console.log("Closing HTTP server...");
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }

    console.log("\n" + "=".repeat(80));
    console.log("Graceful shutdown completed");
    console.log("=".repeat(80) + "\n");

    process.exit(0);
  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error("Error during shutdown");
    console.error("=".repeat(80));
    console.error("\nError:", error.message);
    console.error("\n" + "=".repeat(80) + "\n");
    process.exit(1);
  }
}

// Graceful shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

async function startServer() {
  try {
    await bridgeController.initialize();
    app.listen(port, () => {
      console.log("=".repeat(70));
      console.log(
        "Fabric E-Sign API Server Started (Multi-Organization Support)"
      );
      console.log("=".repeat(70));
      console.log(`Server running on: http://localhost:${port}`);
      console.log(`Health check: http://localhost:${port}/health`);
      console.log(`API info: http://localhost:${port}/api`);
      console.log(
        `Initialize all networks: POST http://localhost:${port}/api/init`
      );
      console.log("=".repeat(70));
      console.log("=".repeat(70));
      console.log(`Fabric Configuration:`);
      console.log(`Channel: ${config.channelName}`);
      console.log(`Chaincode: ${config.chaincodeName}`);
      console.log(`Default Org: ${config.defaultOrg}`);
      console.log(`Available Organizations:`);

      config.getAllOrgs().forEach((orgName) => {
        const orgConfig = config.getOrgConfig(orgName);
        console.log(
          `     - ${orgConfig.name} (${orgConfig.mspId}) - ${orgConfig.domain}`
        );
        console.log(
          `       Collections: ${orgConfig.collections.documents}, ${orgConfig.collections.logs}`
        );
        console.log(`       CA: ${orgConfig.endpoints.ca.url}`);
      });

      console.log("=".repeat(70));
      console.log("Available API Endpoints (matches your chaincode):");
      console.log("   wenhook:");
      console.log("     - POST /api/webhook/org1 (create in Org1)");
      console.log("     - POST /api/webhook/org2 (create in Org2)");
      console.log("     - GET /api/logs/webhook/org/org1/[documentID] (read log from Org1)");
      console.log("     - GET /api/logs/webhook/org/org2/[documentID] (read log from Org2)");
      console.log("     - GET /api/document/webhook/org/org1/integrity/[documentID] (read doc integrity from Org1)");
      console.log("     - GET /api/document/webhook/org/org2/integrity/[documentID] (read doc integrity from Org2)");
      console.log("     - GET /api/logs/webhook/org/org1/integrity/[documentID] (read log integrity from Org1)");
      console.log("     - GET /api/logs/webhook/org/org2/integrity/[documentID] (read log integroty from Org2)");
      console.log("     - GET /api/webhook/status/org1/[requestId] (get status of specific webhook request from Org1)");
      console.log("     - GET /api/webhook/status/org2/[requestId] (get status of specific webhook request from Org2)");
      console.log("     - POST /api/document/webhook/org1/integrity (check doc integrity from Org1)");
      console.log("     - POST /api/document/webhook/org2/integrity (check doc integrity from Org2)");
      console.log("=".repeat(70));
    });
  } catch (error) {
    console.error("\n" + "=".repeat(80));
    console.error("FAILED TO START SERVER");
    console.error("=".repeat(80));
    console.error("\nError:", error.message);
    console.error("\nStack:", error.stack);
    console.error("\n" + "=".repeat(80) + "\n");
    process.exit(1);
  }
}

startServer();

module.exports = app;
