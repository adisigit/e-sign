#!/bin/bash

FABRIC_NETWORK=fabric_esign

docker run --rm -it \
  --network ${FABRIC_NETWORK} \
  -v /home/adi/esign:/workspace \
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

mv report.html report-direct.html
