#!/bin/bash
set -euo pipefail

# Parent of caliper-workspace/ (this script lives in caliper-workspace/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CALIPER_WS="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Override if the repo is not laid out as <repo>/caliper-workspace/
: "${ESIGN_REPO:=$(cd "${CALIPER_WS}/.." && pwd)}"

FABRIC_NETWORK=fabric_esign

docker run --rm -it \
  --network "${FABRIC_NETWORK}" \
  -v "${ESIGN_REPO}:/workspace" \
  -w /workspace/caliper-workspace \
  caliper-node22:0.7.1 \
  caliper launch manager \
    --caliper-workspace /workspace/caliper-workspace \
    --caliper-networkconfig /workspace/caliper-workspace/networks/networkconfig.yaml \
    --caliper-benchconfig /workspace/caliper-workspace/benchmarks/benchmark-webhook-config.yaml \
    --caliper-flow-only-test \
    --caliper-bind-sut fabric:2.5 \
    --caliper-bind-cwd /workspace/caliper-workspace \
    --caliper-fabric-gateway-enabled

mv "${CALIPER_WS}/report.html" "${CALIPER_WS}/report-direct.html"
