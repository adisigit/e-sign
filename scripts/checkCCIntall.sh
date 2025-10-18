#!/bin/bash
set -euo pipefail

export FABRIC_CFG_PATH=${PWD}/docker
CHANNEL_NAME="e-sign-channel"

# Function cek chaincode di peer
check_chaincode() {
  local ORG=$1
  local PEER=$2
  local PORT=$3

  echo ">>> Checking chaincodes on $PEER.$ORG"

  CORE_PEER_LOCALMSPID=${ORG}MSP \
  CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/${ORG,,}.esign.com/users/Admin@${ORG,,}.esign.com/msp \
  CORE_PEER_ADDRESS=${PEER}.${ORG,,}.esign.com:${PORT} \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/${ORG,,}.esign.com/msp/tlscacerts/tlsca-esign.pem \
  peer lifecycle chaincode queryinstalled || echo "No chaincode installed on $PEER.$ORG"

  CORE_PEER_LOCALMSPID=${ORG}MSP \
  CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/${ORG,,}.esign.com/users/Admin@${ORG,,}.esign.com/msp \
  CORE_PEER_ADDRESS=${PEER}.${ORG,,}.esign.com:${PORT} \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/${ORG,,}.esign.com/msp/tlscacerts/tlsca-esign.pem \
  peer lifecycle chaincode querycommitted -C $CHANNEL_NAME || echo "No chaincode committed on $PEER.$ORG" \

  echo ""
}

# Cek di Org1 peer0 (7051)
check_chaincode Org1 peer0 7051

# Cek di Org1 peer1 (8051)
check_chaincode Org1 peer1 8051

# Cek di Org2 peer0 (9051)
check_chaincode Org2 peer0 9051

# Cek di Org2 peer1 (10051)
check_chaincode Org2 peer1 10051
