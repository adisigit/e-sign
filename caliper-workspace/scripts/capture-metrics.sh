#!/bin/bash
# File: capture-metrics.sh

# Setup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
METRICS_DIR=${PWD}/metrics/$TIMESTAMP

# Buat direktori
mkdir -p $METRICS_DIR

echo "📊 Capturing metrics for benchmark run: $TIMESTAMP"

# 1. Capture system info
echo "💻 System Information" > $METRICS_DIR/system-info.txt
echo "===================" >> $METRICS_DIR/system-info.txt
uname -a >> $METRICS_DIR/system-info.txt
echo "" >> $METRICS_DIR/system-info.txt
lscpu | grep -E "Model name|CPU\(s\)|Core|Thread" >> $METRICS_DIR/system-info.txt
free -h >> $METRICS_DIR/system-info.txt
df -h >> $METRICS_DIR/system-info.txt

# 2. Capture Docker info
echo "🐳 Docker Containers" > $METRICS_DIR/docker-info.txt
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" >> $METRICS_DIR/docker-info.txt

# 3. Capture metrics BEFORE benchmark
echo "📈 Capturing BEFORE metrics..."
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" > $METRICS_DIR/metrics-before.txt

# 4. Monitor DURING benchmark (background)
echo "📊 Starting continuous monitoring..."
(
  while true; do
    docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.NetIO}},{{.BlockIO}}" >> $METRICS_DIR/metrics-during.csv
    sleep 5
  done
) &
MONITOR_PID=$!
echo $MONITOR_PID > $METRICS_DIR/monitor.pid

echo "✅ Monitoring started (PID: $MONITOR_PID)"
echo "📁 Results will be saved to: $METRICS_DIR"
echo ""
echo "Run your Caliper benchmark now, then run: ./stop-metrics.sh"