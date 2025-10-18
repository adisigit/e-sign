#!/bin/bash
CHANNEL_NAME=e-sign-channel
# export PATH=${PWD}/../bin:$PATH

echo ">>> Creating channel ${CHANNEL_NAME}..."

# Use Org1 admin to create the channel
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp
export CORE_BCCSP_SW_FILEKEYSTORE_KEYSTORE=${CORE_PEER_MSPCONFIGPATH}/keystore

# Generate channel block (Raft admin flow)
export FABRIC_CFG_PATH=${PWD}/configtx
configtxgen -profile ChannelUsingRaft -channelID ${CHANNEL_NAME} -outputBlock ./system-genesis-block/${CHANNEL_NAME}.block
# Restore peer CLI config path
export FABRIC_CFG_PATH=${PWD}/docker

# Ask the orderer (admin API) to join the channel
# Join orderer via admin API if not already joined
if ! osnadmin channel list \
  --orderer-address orderer.esign.com:7053 \
  --ca-file ${PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/ca.crt \
  --client-cert ${PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/server.crt \
  --client-key ${PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/server.key | grep -q "\"name\": \"${CHANNEL_NAME}\""; then
  osnadmin channel join \
    --channelID ${CHANNEL_NAME} \
    --config-block ./system-genesis-block/${CHANNEL_NAME}.block \
    --orderer-address orderer.esign.com:7053 \
    --ca-file ${PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/ca.crt \
    --client-cert ${PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/server.crt \
    --client-key ${PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/server.key
fi

# --- Join peer0.org1 ---
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org1.esign.com:7051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls/ca.crt
export CORE_BCCSP_SW_FILEKEYSTORE_KEYSTORE=${CORE_PEER_MSPCONFIGPATH}/keystore
peer channel join -b ./system-genesis-block/${CHANNEL_NAME}.block || true

# --- Join peer1.org1 ---
export CORE_PEER_ADDRESS=peer1.org1.esign.com:8051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer1.org1.esign.com/tls/ca.crt
export CORE_BCCSP_SW_FILEKEYSTORE_KEYSTORE=${CORE_PEER_MSPCONFIGPATH}/keystore
peer channel join -b ./system-genesis-block/${CHANNEL_NAME}.block || true

# --- Join peer0.org2 ---
export CORE_PEER_LOCALMSPID="Org2MSP"
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org2.esign.com/users/Admin@org2.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org2.esign.com:9051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.esign.com/peers/peer0.org2.esign.com/tls/ca.crt
export CORE_BCCSP_SW_FILEKEYSTORE_KEYSTORE=${CORE_PEER_MSPCONFIGPATH}/keystore
peer channel join -b ./system-genesis-block/${CHANNEL_NAME}.block || true

# --- Join peer1.org2 ---
export CORE_PEER_ADDRESS=peer1.org2.esign.com:10051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.esign.com/peers/peer1.org2.esign.com/tls/ca.crt
export CORE_BCCSP_SW_FILEKEYSTORE_KEYSTORE=${CORE_PEER_MSPCONFIGPATH}/keystore
peer channel join -b ./system-genesis-block/${CHANNEL_NAME}.block || true

echo ">>> All peers joined channel ${CHANNEL_NAME}"

# --- Update anchor Org1 ---
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org1.esign.com:7051
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls/ca.crt
export CORE_BCCSP_SW_FILEKEYSTORE_KEYSTORE=${CORE_PEER_MSPCONFIGPATH}/keystore

echo ">>> Updating anchor peer for Org1..."
# Live config update for Org1 anchor peers
export ORDERER_CA=${PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/ca.crt
peer channel fetch config ./system-genesis-block/config_block.pb -o orderer.esign.com:7050 -c ${CHANNEL_NAME} --tls --cafile ${ORDERER_CA}
configtxlator proto_decode --input ./system-genesis-block/config_block.pb --type common.Block \
  | jq .data.data[0].payload.data.config > ./system-genesis-block/config.json
jq '.channel_group.groups.Application.groups.Org1MSP.values += {
  "AnchorPeers": {
    "mod_policy": "Admins",
    "value": {"anchor_peers": [
      {"host":"peer0.org1.esign.com","port":7051},
      {"host":"peer1.org1.esign.com","port":8051}
    ]},
    "version": "0"
  }
}' ./system-genesis-block/config.json > ./system-genesis-block/modified_config.json
configtxlator proto_encode --input ./system-genesis-block/config.json --type common.Config > ./system-genesis-block/config.pb
configtxlator proto_encode --input ./system-genesis-block/modified_config.json --type common.Config > ./system-genesis-block/modified_config.pb
configtxlator compute_update --channel_id ${CHANNEL_NAME} --original ./system-genesis-block/config.pb --updated ./system-genesis-block/modified_config.pb > ./system-genesis-block/org1_update.pb
configtxlator proto_decode --input ./system-genesis-block/org1_update.pb --type common.ConfigUpdate \
  | jq -n --argfile u ./system-genesis-block/org1_update.pb '{"payload":{"header":{"channel_header":{"channel_id":"'"${CHANNEL_NAME}"'","type":2}},"data":{"config_update":$u}}}' \
  > ./system-genesis-block/org1_update_envelope.json
configtxlator proto_encode --input ./system-genesis-block/org1_update_envelope.json --type common.Envelope > ./system-genesis-block/org1_update_envelope.pb
peer channel signconfigtx -f ./system-genesis-block/org1_update_envelope.pb || true
peer channel update -f ./system-genesis-block/org1_update_envelope.pb -c ${CHANNEL_NAME} -o orderer.esign.com:7050 --tls --cafile ${ORDERER_CA}

# --- Update anchor Org2 ---
export CORE_PEER_LOCALMSPID="Org2MSP"
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org2.esign.com/users/Admin@org2.esign.com/msp
export CORE_PEER_ADDRESS=peer0.org2.esign.com:9051
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.esign.com/peers/peer0.org2.esign.com/tls/ca.crt
export CORE_BCCSP_SW_FILEKEYSTORE_KEYSTORE=${CORE_PEER_MSPCONFIGPATH}/keystore

echo ">>> Updating anchor peer for Org2..."
# Live config update for Org2 anchor peers
peer channel fetch config ./system-genesis-block/config_block.pb -o orderer.esign.com:7050 -c ${CHANNEL_NAME} --tls --cafile ${ORDERER_CA}
configtxlator proto_decode --input ./system-genesis-block/config_block.pb --type common.Block \
  | jq .data.data[0].payload.data.config > ./system-genesis-block/config.json
jq '.channel_group.groups.Application.groups.Org2MSP.values += {
  "AnchorPeers": {
    "mod_policy": "Admins",
    "value": {"anchor_peers": [
      {"host":"peer0.org2.esign.com","port":9051},
      {"host":"peer1.org2.esign.com","port":10051}
    ]},
    "version": "0"
  }
}' ./system-genesis-block/config.json > ./system-genesis-block/modified_config.json
configtxlator proto_encode --input ./system-genesis-block/config.json --type common.Config > ./system-genesis-block/config.pb
configtxlator proto_encode --input ./system-genesis-block/modified_config.json --type common.Config > ./system-genesis-block/modified_config.pb
configtxlator compute_update --channel_id ${CHANNEL_NAME} --original ./system-genesis-block/config.pb --updated ./system-genesis-block/modified_config.pb > ./system-genesis-block/org2_update.pb
configtxlator proto_decode --input ./system-genesis-block/org2_update.pb --type common.ConfigUpdate \
  | jq -n --argfile u ./system-genesis-block/org2_update.pb '{"payload":{"header":{"channel_header":{"channel_id":"'"${CHANNEL_NAME}"'","type":2}},"data":{"config_update":$u}}}' \
  > ./system-genesis-block/org2_update_envelope.json
configtxlator proto_encode --input ./system-genesis-block/org2_update_envelope.json --type common.Envelope > ./system-genesis-block/org2_update_envelope.pb
peer channel signconfigtx -f ./system-genesis-block/org2_update_envelope.pb || true
peer channel update -f ./system-genesis-block/org2_update_envelope.pb -c ${CHANNEL_NAME} -o orderer.esign.com:7050 --tls --cafile ${ORDERER_CA}

echo ">>> Channel ${CHANNEL_NAME} created and peers joined"