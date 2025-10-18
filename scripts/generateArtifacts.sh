#!/bin/bash

set -e

# Make sure configtxgen is in PATH
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/configtx

function generateArtifacts() {
  echo ">>> Generating Genesis Block and Channel Transaction..."

  mkdir -p system-genesis-block

  # Genesis block for orderer
  configtxgen -profile TwoOrgsOrdererGenesis \
    -channelID system-channel \
    -outputBlock ./system-genesis-block/genesis.block

  # Channel transaction for e-sign-channel
  configtxgen -profile TwoOrgsChannel \
    -outputCreateChannelTx ./system-genesis-block/e-sign-channel.tx \
    -channelID e-sign-channel

  # Anchor peer update untuk Org1
  configtxgen -profile TwoOrgsChannel \
    -outputAnchorPeersUpdate ./system-genesis-block/Org1MSPanchors.tx \
    -channelID e-sign-channel -asOrg Org1MSP

  # Anchor peer update untuk Org2
  configtxgen -profile TwoOrgsChannel \
    -outputAnchorPeersUpdate ./system-genesis-block/Org2MSPanchors.tx \
    -channelID e-sign-channel -asOrg Org2MSP

}

generateArtifacts
