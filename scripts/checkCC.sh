#!/bin/bash
set -euo pipefail

export FABRIC_CFG_PATH=${PWD}/docker


export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org1.esign.com:7051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem

# JSON untuk transient
DOC_JSON=$(cat <<EOF
{
  "collection": "collectionOrg1",
  "documentID": "doc1",
  "documentName": "nama-dokumen",
  "ownerID": "ksadbakd3",
  "ownerName": "Sigit",
  "status": "OPEN"
}
EOF
)
# Encode ke base64 (hapus newline biar aman)
DOC_BASE64=$(echo -n "$DOC_JSON" | base64 | tr -d '\n')

peer chaincode invoke \
  -o orderer.esign.com:7050 \
  --tls true \
  --cafile ${PWD}//organizations/ordererOrganizations/esign.com/msp/tlscacerts/tlsca-esign.pem \
  -C e-sign-channel \
  -n basic \
  --peerAddresses peer0.org1.esign.com:7051 \
  --tlsRootCertFiles ${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls/ca.crt \
  --transient "{\"doc\":\"$DOC_BASE64\"}" \
  -c '{"Args":["CreatePrivateDocument"]}'



