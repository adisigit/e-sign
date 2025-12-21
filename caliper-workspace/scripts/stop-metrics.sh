#!/bin/bash
# File: stop-metrics.sh

LATEST_DIR=$(ls -td ${PWD}/metrics/*/ | head -1)

if [ -f "$LATEST_DIR/monitor.pid" ]; then
  MONITOR_PID=$(cat $LATEST_DIR/monitor.pid)
  echo "🛑 Stopping monitoring (PID: $MONITOR_PID)..."
  kill $MONITOR_PID
  rm $LATEST_DIR/monitor.pid
  
  # Capture AFTER metrics
  echo "📈 Capturing AFTER metrics..."
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" > $LATEST_DIR/metrics-after.txt
  
  echo "✅ Metrics saved to: $LATEST_DIR"
  echo ""
  echo "📊 Summary:"
  ls -lh $LATEST_DIR/
else
  echo "❌ No monitoring process found"
fi