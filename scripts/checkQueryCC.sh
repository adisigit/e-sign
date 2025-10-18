#!/bin/bash
set -uo pipefail

export FABRIC_CFG_PATH=${PWD}/docker

# -------- Query from Org1 (peer0) --------
echo ">>> Query private aread all document in Org1 from Org1 collection"
if ! CORE_PEER_LOCALMSPID=Org1MSP \
   CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp \
   CORE_PEER_ADDRESS=peer0.org1.esign.com:7051 \
   CORE_PEER_TLS_ENABLED=true \
   CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem \
   peer chaincode query \
      -C e-sign-channel \
      -n basic \
      -c '{"Args":["ReadAllDocumentByOrg","collectionOrg1"]}'; then
    echo "Org1 could not read the asset"
fi

# -------- Query from Org2 (peer0) --------
echo ">>> Query private aread all document in Org1 from Org2 collection"
if ! CORE_PEER_LOCALMSPID=Org2MSP \
   CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org2.esign.com/users/Admin@org2.esign.com/msp \
   CORE_PEER_ADDRESS=peer0.org2.esign.com:9051 \
   CORE_PEER_TLS_ENABLED=true \
   CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.esign.com/msp/tlscacerts/tlsca-esign.pem \
   peer chaincode query \
      -C e-sign-channel \
      -n basic \
      -c '{"Args":["ReadAllDocumentByOrg","collectionOrg1"]}'; then
    echo "Org2 could not read the asset"
fi
