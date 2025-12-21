#!/bin/bash
set -euo pipefail

CC_NAME=basic
CC_SRC_PATH=/workspace/chaincode-go
CC_RUNTIME_LANGUAGE=golang
CC_VERSION=1.1
CC_SEQUENCE=2
CHANNEL_NAME=e-sign-channel
CC_PACKAGE=${CC_NAME}.tar.gz

# export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/docker

echo ">>> Packaging chaincode"
rm -f ${CC_PACKAGE}
peer lifecycle chaincode package ${CC_PACKAGE} \
  --path ${CC_SRC_PATH} --lang ${CC_RUNTIME_LANGUAGE} --label ${CC_NAME}_${CC_VERSION}

# ----------- Org1 -----------
echo ">>> Install CC on peer0.org1"
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org1.esign.com:7051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem
peer lifecycle chaincode install ${CC_PACKAGE}

echo ">>> Install CC on peer1.org1"
export CORE_PEER_ADDRESS=peer1.org1.esign.com:8051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem
peer lifecycle chaincode install ${CC_PACKAGE}

# ----------- Org2 -----------
echo ">>> Install CC on peer0.org2"
export CORE_PEER_LOCALMSPID=Org2MSP
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org2.esign.com/users/Admin@org2.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org2.esign.com:9051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.esign.com/msp/tlscacerts/tlsca-esign.pem
peer lifecycle chaincode install ${CC_PACKAGE}

echo ">>> Install CC on peer1.org2"
export CORE_PEER_ADDRESS=peer1.org2.esign.com:10051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.esign.com/msp/tlscacerts/tlsca-esign.pem
peer lifecycle chaincode install ${CC_PACKAGE}

# ----------- Query package ID -----------
echo ">>> Query installed CC on peer0.org1"
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org1.esign.com:7051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem
PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep "${CC_NAME}_${CC_VERSION}" | awk -F "[, ]+" '{print $3}')
echo ">>> Found package ID: ${PACKAGE_ID}"

echo ">>> Waiting for orderer to be ready..."
sleep 10

# ----------- Approve CC Org1 -----------
echo ">>> Approve chaincode for Org1"
peer lifecycle chaincode approveformyorg \
  -o orderer.esign.com:7050 \
  --ordererTLSHostnameOverride orderer.esign.com \
  --tls \
  --cafile ${PWD}/organizations/ordererOrganizations/esign.com/msp/tlscacerts/tlsca-esign.pem \
  --channelID ${CHANNEL_NAME} --name ${CC_NAME} --version ${CC_VERSION} \
  --package-id ${PACKAGE_ID} --sequence ${CC_SEQUENCE} \
  --collections-config ${PWD}/chaincode-go/collections_config.json \
  --signature-policy "OR('Org1MSP.peer','Org2MSP.peer')"

# ----------- Approve CC Org2 -----------
echo ">>> Approve chaincode for Org2"
export CORE_PEER_LOCALMSPID=Org2MSP
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org2.esign.com/users/Admin@org2.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org2.esign.com:9051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.esign.com/msp/tlscacerts/tlsca-esign.pem
peer lifecycle chaincode approveformyorg \
  -o orderer.esign.com:7050 \
  --ordererTLSHostnameOverride orderer.esign.com \
  --tls \
  --cafile ${PWD}/organizations/ordererOrganizations/esign.com/msp/tlscacerts/tlsca-esign.pem \
  --channelID ${CHANNEL_NAME} --name ${CC_NAME} --version ${CC_VERSION} \
  --package-id ${PACKAGE_ID} --sequence ${CC_SEQUENCE} \
  --collections-config ${PWD}/chaincode-go/collections_config.json \
  --signature-policy "OR('Org1MSP.peer','Org2MSP.peer')"

# ----------- Check commit readiness -----------
echo ">>> Check commit readiness"
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org1.esign.com:7051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem
peer lifecycle chaincode checkcommitreadiness \
  --channelID ${CHANNEL_NAME} --name ${CC_NAME} --version ${CC_VERSION} \
  --sequence ${CC_SEQUENCE} \
  --collections-config ${PWD}/chaincode-go/collections_config.json \
  --signature-policy "OR('Org1MSP.peer','Org2MSP.peer')" \
  --output json

# ----------- Commit CC -----------
echo ">>> Commit chaincode"
peer lifecycle chaincode commit \
  -o orderer.esign.com:7050 \
  --ordererTLSHostnameOverride orderer.esign.com \
  --tls \
  --cafile ${PWD}/organizations/ordererOrganizations/esign.com/msp/tlscacerts/tlsca-esign.pem \
  --channelID ${CHANNEL_NAME} --name ${CC_NAME} --version ${CC_VERSION} --sequence ${CC_SEQUENCE} \
  --collections-config ${PWD}/chaincode-go/collections_config.json \
  --signature-policy "OR('Org1MSP.peer','Org2MSP.peer')" \
  --peerAddresses peer0.org1.esign.com:7051 --tlsRootCertFiles ${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls/ca.crt \
  --peerAddresses peer0.org2.esign.com:9051 --tlsRootCertFiles ${PWD}/organizations/peerOrganizations/org2.esign.com/peers/peer0.org2.esign.com/tls/ca.crt

# ----------- Query committed CC -----------
echo ">>> Query committed chaincode"
peer lifecycle chaincode querycommitted --channelID ${CHANNEL_NAME} --name ${CC_NAME}

echo ">>> Chaincode ${CC_NAME} deployed on channel ${CHANNEL_NAME}"
echo ">>> Endorsement policy: OR('Org1MSP.peer','Org2MSP.peer')"