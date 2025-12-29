#!/bin/bash

npx caliper launch manager \
  --caliper-workspace ${PWD} \
  --caliper-networkconfig ${PWD}/networks/networkconfig.yaml \
  --caliper-benchconfig ${PWD}/benchmarks/benchmark-webhook-config.yaml \
  --caliper-flow-only-test \
  --caliper-fabric-gateway-enabled \
  --caliper-bind-sut fabric:2.5  

# Rename report
mv ${PWD}/report.html ${PWD}/report-direct.html