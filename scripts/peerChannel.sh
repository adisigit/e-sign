#!/bin/bash
set -euo pipefail

CHANNEL_NAME="e-sign-channel"
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/docker

# --- Daftar peer dan org ---
# Format: PEERS[peer_name]="MSP:MSP_PATH:TLS_ROOTCERT:PEER_ADDRESS"
declare -A PEERS
PEERS[peer0.org1.esign.com]="Org1MSP:${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp:${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem:peer0.org1.esign.com:7051"
PEERS[peer1.org1.esign.com]="Org1MSP:${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp:${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem:peer1.org1.esign.com:8051"
PEERS[peer0.org2.esign.com]="Org2MSP:${PWD}/organizations/peerOrganizations/org2.esign.com/users/Admin@org2.esign.com/msp:${PWD}/organizations/peerOrganizations/org2.esign.com/msp/tlscacerts/tlsca-esign.pem:peer0.org2.esign.com:9051"
PEERS[peer1.org2.esign.com]="Org2MSP:${PWD}/organizations/peerOrganizations/org2.esign.com/users/Admin@org2.esign.com/msp:${PWD}/organizations/peerOrganizations/org2.esign.com/msp/tlscacerts/tlsca-esign.pem:peer1.org2.esign.com:10051"

echo ">>> Checking peers join status on channel $CHANNEL_NAME"
for peer in "${!PEERS[@]}"; do
  IFS=":" read -r MSP MSP_PATH TLS_ROOTCERT PEER_ADDRESS <<< "${PEERS[$peer]}"

  export CORE_PEER_LOCALMSPID=$MSP
  export CORE_PEER_MSPCONFIGPATH=$MSP_PATH
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_TLS_ROOTCERT_FILE=$TLS_ROOTCERT
  export CORE_PEER_ADDRESS=$PEER_ADDRESS

  echo -n "Checking $peer ($MSP) ... "
  peer channel list 
  # if peer channel list | grep -q "$CHANNEL_NAME"; then
  #   echo "✅ joined"
  # else
  #   echo "❌ NOT joined"
  # fi
done

echo ">>> Done"
