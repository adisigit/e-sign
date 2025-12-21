const axios = require('axios');
const fs = require('fs');

// ============ KONFIGURASI ============
const CONFIG = {
  apiUrl: 'http://localhost:4000',
  orgName: 'org1',
  collectionLog: 'collectionOrg1Log',
  authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiY2VrIiwiZW1haWwiOiJjZWtAc2luZGlrYS5jby5pZCIsInByZWZlcnJlZF91c2VybmFtZSI6ImNlayIsInVzZXJfaWQiOiJrc2Ria2RzaGZpcmV3cm8zOXJ1ZWRramVoa2RzIiwicm9sZSI6Imthcnlhd2FuIiwiaWF0IjoxNzY0MzI4MjkzLCJleHAiOjE3NjQzMzE4OTN9.6CHKaTD3EszE5sFbzPB6WyIXLeuXoryJkti-nlExm20',
  
  // Load test settings
  totalRequests: 100,
  concurrency: 10, // Berapa request parallel
  
  // Output files
  sentDocsFile: 'sent-documents.json',
  failedDocsFile: 'failed-documents.json',
  reportFile: 'test-report.json'
};

const ACTIONS = ['CREATE', 'VIEW', 'SIGN', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT'];

// ============ METRICS ============
const metrics = {
  total: 0,
  success: 0,
  failed: 0,
  latencies: [],
  errors: [],
  sentDocs: [],
  failedDocs: [],
  startTime: null,
  endTime: null
};

// ============ HELPER FUNCTIONS ============
function getRandomAction() {
  return ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ MAIN FUNCTION ============
async function sendRequest(index) {
  const documentID = `DOC-${Date.now()}-${index}`;
  const action = getRandomAction();
  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${CONFIG.apiUrl}/api/logs/${CONFIG.orgName}`,
      {
        collectionLog: CONFIG.collectionLog,
        documentID,
        action,
        timestamp: new Date().toISOString(),
        testIndex: index
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.authToken}`
        },
        timeout: 30000
      }
    );

    const latency = Date.now() - startTime;
    
    metrics.success++;
    metrics.latencies.push(latency);
    metrics.sentDocs.push({ documentID, action, latency, timestamp: new Date().toISOString() });

    // Progress indicator
    if (metrics.total % 100 === 0) {
      console.log(`✓ Progress: ${metrics.total}/${CONFIG.totalRequests} (Success: ${metrics.success}, Failed: ${metrics.failed})`);
    }

    return { success: true, documentID, action, latency };
  } catch (error) {
    const latency = Date.now() - startTime;
    
    metrics.failed++;
    metrics.errors.push({
      documentID,
      action,
      error: error.message,
      code: error.code,
      status: error.response?.status,
      timestamp: new Date().toISOString()
    });
    metrics.failedDocs.push({ documentID, action, error: error.message });

    console.error(`✗ Failed: ${documentID} - ${error.message}`);
    
    return { success: false, documentID, action, error: error.message };
  } finally {
    metrics.total++;
  }
}

// ============ CONCURRENT EXECUTOR ============
async function runLoadTest() {
  console.log('\n🚀 Starting NATS JetStream Load Test...\n');
  console.log(`Configuration:
  - API URL: ${CONFIG.apiUrl}
  - Total Requests: ${CONFIG.totalRequests}
  - Concurrency: ${CONFIG.concurrency}
  - Actions: ${ACTIONS.join(', ')}\n`);

  metrics.startTime = Date.now();

  const promises = [];
  
  for (let i = 0; i < CONFIG.totalRequests; i++) {
    promises.push(sendRequest(i));
    
    // Control concurrency
    if (promises.length >= CONFIG.concurrency) {
      await Promise.race(promises);
      promises.splice(promises.findIndex(p => p), 1);
    }
  }

  // Wait for remaining requests
  await Promise.all(promises);

  metrics.endTime = Date.now();
}

// ============ REPORT GENERATOR ============
function generateReport() {
  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const successRate = (metrics.success / metrics.total * 100).toFixed(2);
  
  const sortedLatencies = metrics.latencies.sort((a, b) => a - b);
  const avgLatency = sortedLatencies.length > 0 
    ? (sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length).toFixed(2)
    : 0;
  const minLatency = sortedLatencies.length > 0 ? sortedLatencies[0] : 0;
  const maxLatency = sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0;
  const p50 = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] : 0;
  const p95 = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] : 0;
  const p99 = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] : 0;
  
  const throughput = (metrics.total / duration).toFixed(2);

  const report = {
    summary: {
      totalRequests: metrics.total,
      successful: metrics.success,
      failed: metrics.failed,
      successRate: `${successRate}%`,
      duration: `${duration.toFixed(2)}s`,
      throughput: `${throughput} req/s`
    },
    latency: {
      avg: `${avgLatency}ms`,
      min: `${minLatency}ms`,
      max: `${maxLatency}ms`,
      p50: `${p50}ms`,
      p95: `${p95}ms`,
      p99: `${p99}ms`
    },
    errors: metrics.errors.slice(0, 10) // Top 10 errors
  };

  // Console output
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 LOAD TEST REPORT');
  console.log('='.repeat(60));
  console.log('\n📈 Summary:');
  console.log(`  Total Requests:    ${report.summary.totalRequests}`);
  console.log(`  ✓ Successful:      ${report.summary.successful}`);
  console.log(`  ✗ Failed:          ${report.summary.failed}`);
  console.log(`  Success Rate:      ${report.summary.successRate}`);
  console.log(`  Duration:          ${report.summary.duration}`);
  console.log(`  Throughput:        ${report.summary.throughput}`);
  
  console.log('\n⏱️  Latency:');
  console.log(`  Average:           ${report.latency.avg}`);
  console.log(`  Min:               ${report.latency.min}`);
  console.log(`  Max:               ${report.latency.max}`);
  console.log(`  50th percentile:   ${report.latency.p50}`);
  console.log(`  95th percentile:   ${report.latency.p95}`);
  console.log(`  99th percentile:   ${report.latency.p99}`);

  if (metrics.failed > 0) {
    console.log('\n❌ Sample Errors:');
    report.errors.slice(0, 5).forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err.documentID}: ${err.error}`);
    });
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Save to files
  fs.writeFileSync(CONFIG.sentDocsFile, JSON.stringify(metrics.sentDocs, null, 2));
  fs.writeFileSync(CONFIG.failedDocsFile, JSON.stringify(metrics.failedDocs, null, 2));
  fs.writeFileSync(CONFIG.reportFile, JSON.stringify(report, null, 2));

  console.log('📁 Files saved:');
  console.log(`  - ${CONFIG.sentDocsFile} (${metrics.sentDocs.length} documents)`);
  console.log(`  - ${CONFIG.failedDocsFile} (${metrics.failedDocs.length} documents)`);
  console.log(`  - ${CONFIG.reportFile}\n`);

  return report;
}

// ============ MAIN EXECUTION ============
async function main() {
  try {
    await runLoadTest();
    generateReport();
    
    // Exit code based on success rate
    const successRate = (metrics.success / metrics.total * 100);
    if (successRate < 95) {
      console.log('⚠️  Warning: Success rate below 95%');
      process.exit(1);
    } else {
      console.log('✅ Test completed successfully!');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
main();