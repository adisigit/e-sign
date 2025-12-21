#!/bin/bash
# Smart Peak Detection v3 — with System Info + Per-Container Peak Tracking

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
METRICS_DIR=${PWD}/metrics/$TIMESTAMP
mkdir -p $METRICS_DIR

echo "📊 Smart Peak Detection"
echo "========================================"

CHECK_INTERVAL=5
MIN_SAMPLES=8
DECLINE_THRESHOLD=10
DECLINE_COUNT=3

echo "Timestamp,Name,CPUPerc,MemUsage,NetIO,BlockIO" > $METRICS_DIR/metrics-during.csv

SAMPLE_COUNT=0
PEAK_CPU=0
DECLINE_STREAK=0
declare -A MAX_CONTAINER_CPU

echo ""
echo "💻 Capturing system info..."

# =============== SYSTEM INFO ===============
echo "💻 System Information" > $METRICS_DIR/system-info.txt
echo "===================" >> $METRICS_DIR/system-info.txt
uname -a >> $METRICS_DIR/system-info.txt
echo "" >> $METRICS_DIR/system-info.txt
lscpu | grep -E "Model name|CPU\(s\)|Core|Thread" >> $METRICS_DIR/system-info.txt
echo "" >> $METRICS_DIR/system-info.txt
free -h >> $METRICS_DIR/system-info.txt
echo "" >> $METRICS_DIR/system-info.txt
df -h >> $METRICS_DIR/system-info.txt

echo ""
echo "🌡️ Warming up collecting samples..."

# 2. Capture Docker info
echo "🐳 Docker Containers" > $METRICS_DIR/docker-info.txt
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" >> $METRICS_DIR/docker-info.txt

# 3. Capture metrics BEFORE benchmark
echo "📈 Capturing BEFORE metrics..."
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" > $METRICS_DIR/metrics-before.txt

# =============== MAIN LOOP ===============
while true; do
    ((SAMPLE_COUNT++))
    CURRENT_TIME=$(date +%Y-%m-%d\ %H:%M:%S)

    STATS=$(docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.NetIO}},{{.BlockIO}}")

    TOTAL_CPU=0
    CONTAINER_COUNT=0

    while IFS= read -r line; do
        echo "$CURRENT_TIME,$line" >> $METRICS_DIR/metrics-during.csv

        NAME=$(echo "$line" | cut -d',' -f1)
        CPU=$(echo "$line" | cut -d',' -f2 | sed 's/%//')

        if ! [[ $CPU =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
            CPU=0
        fi

        # Track per-container peak
        if [ -z "${MAX_CONTAINER_CPU[$NAME]}" ]; then
            MAX_CONTAINER_CPU[$NAME]=0
        fi
        if (( $(echo "$CPU > ${MAX_CONTAINER_CPU[$NAME]}" | bc -l) )); then
            MAX_CONTAINER_CPU[$NAME]=$CPU
        fi

        TOTAL_CPU=$(echo "$TOTAL_CPU + $CPU" | bc)
        ((CONTAINER_COUNT++))
    done <<< "$STATS"

    AVG_CPU=$(echo "scale=2; $TOTAL_CPU / $CONTAINER_COUNT" | bc)

    if (( $(echo "$AVG_CPU > $PEAK_CPU" | bc -l) )); then
        PEAK_CPU=$AVG_CPU
    fi

    printf "\r📊 Sample %d | Avg CPU: %.2f%% | Peak: %.2f%%" \
       "$SAMPLE_COUNT" "$AVG_CPU" "$PEAK_CPU"

    if [ $SAMPLE_COUNT -le $MIN_SAMPLES ]; then
        sleep $CHECK_INTERVAL
        continue
    fi

    DROP_PERCENT=$(echo "scale=2; (($PEAK_CPU - $AVG_CPU) / $PEAK_CPU) * 100" | bc)

    if (( $(echo "$DROP_PERCENT > $DECLINE_THRESHOLD" | bc -l) )); then
        ((DECLINE_STREAK++))
    else
        DECLINE_STREAK=0
    fi

    if [ $DECLINE_STREAK -ge $DECLINE_COUNT ]; then
        echo ""
        echo "🔥 Peak detected: $PEAK_CPU%"
        echo "📉 Declining confirmed"
        break
    fi

    sleep $CHECK_INTERVAL
done

# =============== PEAK SUMMARY ===============
echo ""
echo "🎯 Writing peak summary..."
echo "🔥 Fabric Benchmark Peak Summary" > $METRICS_DIR/peak-summary.txt
echo "==================================" >> $METRICS_DIR/peak-summary.txt
echo "" >> $METRICS_DIR/peak-summary.txt

echo "📌 Max Average CPU During Peak: $PEAK_CPU%" >> $METRICS_DIR/peak-summary.txt
echo "" >> $METRICS_DIR/peak-summary.txt

echo "📦 Per-Container Peak CPU:" >> $METRICS_DIR/peak-summary.txt
echo "--------------------------" >> $METRICS_DIR/peak-summary.txt

for cname in "${!MAX_CONTAINER_CPU[@]}"; do
    echo "- $cname  →  ${MAX_CONTAINER_CPU[$cname]}%" >> $METRICS_DIR/peak-summary.txt
done

echo "" >> $METRICS_DIR/peak-summary.txt
echo "Total Samples Collected: $SAMPLE_COUNT" >> $METRICS_DIR/peak-summary.txt

echo ""
echo "📁 Metrics saved to: $METRICS_DIR"
