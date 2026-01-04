#!/bin/bash

function createOrg1() {
  echo ">>> Creating Org1 (org1.esign.com)..."

  mkdir -p organizations/peerOrganizations/org1.esign.com/

  export PATH=${PWD}/bin:$PATH
  export FABRIC_CA_CLIENT_HOME=${PWD}/organizations/peerOrganizations/org1.esign.com/

  # Enroll CA Admin
  fabric-ca-client enroll -u https://admin:adminpw@localhost:7054 \
      --caname ca-org1 \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"

  echo "NodeOUs:
  Enable: true
  ClientOUIdentifier:
      Certificate: cacerts/localhost-7054-ca-org1.pem
      OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
      Certificate: cacerts/localhost-7054-ca-org1.pem
      OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
      Certificate: cacerts/localhost-7054-ca-org1.pem
      OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
      Certificate: cacerts/localhost-7054-ca-org1.pem
      OrganizationalUnitIdentifier: orderer" > "${PWD}/organizations/peerOrganizations/org1.esign.com/msp/config.yaml"

  # Register identities on Org1 CA
  fabric-ca-client register --caname ca-org1 --id.name peer0.org1.esign.com --id.secret peer0pw --id.type peer \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"
  fabric-ca-client register --caname ca-org1 --id.name peer1.org1.esign.com --id.secret peer1pw --id.type peer \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"
  fabric-ca-client register --caname ca-org1 --id.name user1 --id.secret user1pw --id.type client \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"
  fabric-ca-client register --caname ca-org1 --id.name org1admin --id.secret org1adminpw --id.type admin \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"

  # Enroll peer0 MSP
  fabric-ca-client enroll -u https://peer0.org1.esign.com:peer0pw@localhost:7054 --caname ca-org1 \
      -M "${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/msp" \
      --csr.hosts peer0.org1.esign.com --csr.hosts localhost \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"
  
  # Copy config.yaml to peer0 MSP
  cp "${PWD}/organizations/peerOrganizations/org1.esign.com/msp/config.yaml" \
     "${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/msp/config.yaml"

  # UPDATED: Use dedicated TLS CA for peer0 TLS enrollment
  echo ">>> Enrolling peer0.org1 TLS using dedicated TLS CA"
  
  # Register peer0 on TLS CA
  TLS_CA_CERT="${PWD}/ca/ca-tls/data-ca-tls/tls-cert.pem"
  TLS_CLIENT_HOME="${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls/fabric-ca-client"
  mkdir -p "${TLS_CLIENT_HOME}"
  export FABRIC_CA_CLIENT_HOME="${TLS_CLIENT_HOME}"
  
  # Enroll TLS CA admin first
  fabric-ca-client enroll -u https://admin:adminpw@localhost:10054 \
    --caname tlsca-esign \
    --tls.certfiles "${TLS_CA_CERT}"
  
  # Register peer0 identity on TLS CA
  fabric-ca-client register --caname tlsca-esign \
    --id.name peer0.org1.esign.com --id.secret peer0-tlspw --id.type peer \
    --tls.certfiles "${TLS_CA_CERT}" || true
  
  # Enroll TLS certificate
  fabric-ca-client enroll -u https://peer0.org1.esign.com:peer0-tlspw@localhost:10054 \
    --caname tlsca-esign \
    -M "${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls" \
    --enrollment.profile tls \
    --csr.cn peer0.org1.esign.com \
    --csr.hosts peer0.org1.esign.com \
    --csr.hosts localhost \
    --tls.certfiles "${TLS_CA_CERT}"

  # Reset FABRIC_CA_CLIENT_HOME for other operations
  export FABRIC_CA_CLIENT_HOME=${PWD}/organizations/peerOrganizations/org1.esign.com/

  # Similar process for peer1
  echo ">>> Enrolling peer1.org1 TLS using dedicated TLS CA"
  
  # Enroll peer1 MSP first
  fabric-ca-client enroll -u https://peer1.org1.esign.com:peer1pw@localhost:7054 --caname ca-org1 \
      -M "${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer1.org1.esign.com/msp" \
      --csr.hosts peer1.org1.esign.com --csr.hosts localhost \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"

  # Copy config.yaml to peer1 MSP
  cp "${PWD}/organizations/peerOrganizations/org1.esign.com/msp/config.yaml" \
     "${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer1.org1.esign.com/msp/config.yaml"

  # TLS enrollment for peer1
  TLS_CLIENT_HOME="${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer1.org1.esign.com/tls/fabric-ca-client"
  mkdir -p "${TLS_CLIENT_HOME}"
  export FABRIC_CA_CLIENT_HOME="${TLS_CLIENT_HOME}"
  
  # Enroll TLS CA admin
  fabric-ca-client enroll -u https://admin:adminpw@localhost:10054 \
    --caname tlsca-esign \
    --tls.certfiles "${TLS_CA_CERT}"
  
  # Register peer1 identity on TLS CA
  fabric-ca-client register --caname tlsca-esign \
    --id.name peer1.org1.esign.com --id.secret peer1-tlspw --id.type peer \
    --tls.certfiles "${TLS_CA_CERT}" || true
  
  # Enroll TLS certificate for peer1
  fabric-ca-client enroll -u https://peer1.org1.esign.com:peer1-tlspw@localhost:10054 \
    --caname tlsca-esign \
    -M "${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer1.org1.esign.com/tls" \
    --enrollment.profile tls \
    --csr.cn peer1.org1.esign.com \
    --csr.hosts peer1.org1.esign.com \
    --csr.hosts localhost \
    --tls.certfiles "${TLS_CA_CERT}"

  # Reset FABRIC_CA_CLIENT_HOME
  export FABRIC_CA_CLIENT_HOME=${PWD}/organizations/peerOrganizations/org1.esign.com/

  # Enroll user1
  fabric-ca-client enroll -u https://user1:user1pw@localhost:7054 --caname ca-org1 \
      -M "${PWD}/organizations/peerOrganizations/org1.esign.com/users/User1@org1.esign.com/msp" \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"

   # Copy config.yaml to user1 MSP
  cp "${PWD}/organizations/peerOrganizations/org1.esign.com/msp/config.yaml" \
     "${PWD}/organizations/peerOrganizations/org1.esign.com/users/User1@org1.esign.com/msp/config.yaml"

  # Enroll org1admin
  fabric-ca-client enroll -u https://org1admin:org1adminpw@localhost:7054 --caname ca-org1 \
      -M "${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp" \
      --tls.certfiles "${PWD}/ca/ca-org1/data-org1/tls-cert.pem"

  # Copy config.yaml to org2admin MSP
  cp "${PWD}/organizations/peerOrganizations/org1.esign.com/msp/config.yaml" \
     "${PWD}/organizations/peerOrganizations/org1.esign.com/users/Admin@org1.esign.com/msp/config.yaml"

  # Setup TLS certificates for peer0
  echo ">>> Setting up peer0.org1 TLS files"
  TLS_DIR=${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls

  cp "${TLS_DIR}/tlscacerts/"*.pem "${TLS_DIR}/ca.crt"
  cp "${TLS_DIR}/signcerts/"*.pem "${TLS_DIR}/server.crt"
  cp "${TLS_DIR}/keystore/"*_sk "${TLS_DIR}/server.key"

  # Setup TLS certificates for peer1
  echo ">>> Setting up peer1.org1 TLS files"
  TLS_DIR=${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer1.org1.esign.com/tls

  cp "${TLS_DIR}/tlscacerts/"*.pem "${TLS_DIR}/ca.crt"
  cp "${TLS_DIR}/signcerts/"*.pem "${TLS_DIR}/server.crt"
  cp "${TLS_DIR}/keystore/"*_sk "${TLS_DIR}/server.key"

  # Ensure Org1 MSP trusts the TLS CA
  mkdir -p "${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts"
  cp "${PWD}/organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls/ca.crt" \
    "${PWD}/organizations/peerOrganizations/org1.esign.com/msp/tlscacerts/tlsca-esign.pem"

  echo ">>> Org1 TLS certificates created successfully using dedicated TLS CA!"
}

createOrg1