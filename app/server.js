const express = require("express");
const cors = require("cors");
const config = require("./config/fabric-config");
const { verifyToken, validateOrgAccess } = require("./middlewares/auth");

// Import controllers
const bridgeController = require("./controllers/bridge-controller");
const userController = require("./controllers/user-controller");
const documentController = require("./controllers/document-controller-nats");
const logController = require("./controllers/log-controller-nats");

// Import middlewares
const {
  errorHandler,
  notFoundHandler,
  asyncHandler,
} = require("./middlewares/error-handler");

const app = express();
const port = 4000;

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
    chaincodeFunctions: [
      "CreatePrivateDocument",
      "CreatePrivateLogDocument",
      "ReadAllDocumentByOrg",
      "ReadAllLogByDocumentID",
    ],
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
      documents: {
        "POST /api/documents/:orgName":
          "Create document in specific organization → CreatePrivateDocument",
        "GET /api/documents/org/:orgName":
          "Get documents from specific organization → ReadAllDocumentByOrg",
      },
      logs: {
        "POST /api/logs/:orgName":
          "Create log in specific organization → CreatePrivateLogDocument",
        "GET /api/logs/org/:orgName/:documentID":
          "Get logs by document ID from specific organization → ReadAllLogByDocumentID",
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

// Multi-org document routes
// app.post(
//   "/api/documents/:orgName",
//   asyncHandler(documentController.createPrivateDocumentOrg)
// );
// app.get(
//   "/api/documents/org/:orgName",
//   asyncHandler(documentController.getDocumentsByOrg)
// );

app.post(
  "/api/documents/:orgName",
  verifyToken,
  validateOrgAccess,
  documentController.createPrivateDocument.bind(documentController)
);
app.get(
  "/api/documents/org/:orgName",
  verifyToken,
  validateOrgAccess,
  documentController.getDocumentsByOrg.bind(documentController)
);

app.get(
  "/api/documents/org/:orgName/integrity",
  verifyToken,
  validateOrgAccess,
  documentController.readAllDocumentByOrgWithIntegrityCheck.bind(documentController)
);
app.get(
  "/api/documents/org/:orgName/verify/integrity/:documentID",
  verifyToken,
  validateOrgAccess,
  documentController.verifyPrivateDataIntegrity.bind(documentController)
);
app.get(
  "/api/documents/org/:orgName/verify/integrity",
  verifyToken,
  validateOrgAccess,
  documentController.verifyAllDocumentsIntegrity.bind(documentController)
);
// Multi-org log routes
// app.post(
//   "/api/logs/:orgName",
//   asyncHandler(logController.createPrivateLogDocumentOrg)
// );
// app.get(
//   "/api/logs/org/:orgName/:documentID",
//   asyncHandler(logController.getLogsByDocumentId)
// );

app.post(
  "/api/logs/:orgName",
  verifyToken,
  validateOrgAccess,
  logController.createPrivateLogDocumentOrg.bind(logController)
);
app.post(
  "/api/logs/webhook/:orgName",
  logController.createPrivateLogDocumentOrgWebhook.bind(logController)
);
app.get(
  "/api/logs/org/:orgName/:documentID",
  verifyToken,
  validateOrgAccess,
  logController.getLogsByDocumentId.bind(logController)
);
app.get(
  "/api/logs/webhook/org/:orgName/:documentID",
  logController.getLogsByDocumentIdWebhook.bind(logController)
);
app.get(
  "/api/logs/org/:orgName/integrity/:documentID",
  verifyToken,
  validateOrgAccess,
  logController.readAllLogByDocumentIDWithIntegrityCheck.bind(logController)
);

app.use(notFoundHandler);

app.use(errorHandler);

// Graceful shutdown
// process.on("SIGTERM", () => {
//   console.log("SIGTERM signal received: closing HTTP server");
//   server.close(() => {
//     console.log("HTTP server closed");
//   });
// });

// process.on("SIGINT", () => {
//   console.log("SIGINT signal received: closing HTTP server");
//   server.close(() => {
//     console.log("HTTP server closed");
//   });
// });
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
      console.log(`Your Chaincode Functions:`);
      console.log(`CreatePrivateDocument`);
      console.log(`CreatePrivateLogDocument`);
      console.log(`ReadAllDocumentByOrg`);
      console.log(`ReadAllLogByDocumentID`);
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
      console.log("   Documents:");
      console.log("     - POST /api/documents/org1 (create in Org1)");
      console.log("     - POST /api/documents/org2 (create in Org2)");
      console.log("     - GET /api/documents/org/org1 (read from Org1)");
      console.log("     - GET /api/documents/org/org2 (read from Org2)");
      console.log("   Logs:");
      console.log("     - POST /api/logs/org1 (create in Org1)");
      console.log("     - POST /api/logs/org2 (create in Org2)");
      console.log("     - GET /api/logs/org/org1/[docID] (read from Org1)");
      console.log("     - GET /api/logs/org/org2/[docID] (read from Org2)");
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
