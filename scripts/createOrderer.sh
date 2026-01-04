#!/bin/bash
set -euo pipefail
ROOT_PWD="$(pwd)"

function createOrderer() {
  echo ">>> Prepare dirs"
  mkdir -p organizations/ordererOrganizations/esign.com
  export PATH=${ROOT_PWD}/bin:$PATH

  # 1) Org CA (MSP)
  echo ">>> Enroll the CA admin for OrdererOrg (Org-CA)"
  export FABRIC_CA_CLIENT_HOME=${ROOT_PWD}/organizations/ordererOrganizations/esign.com
  fabric-ca-client enroll -u https://admin:adminpw@localhost:9054 \
    --caname ca-orderer \
    --tls.certfiles "${ROOT_PWD}/ca/ca-orderer/fabric-ca-server-config/tls-cert.pem"

  # MSP config.yaml
  cat > "${ROOT_PWD}/organizations/ordererOrganizations/esign.com/msp/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/localhost-9054-ca-orderer.pem
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/localhost-9054-ca-orderer.pem
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/localhost-9054-ca-orderer.pem
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/localhost-9054-ca-orderer.pem
    OrganizationalUnitIdentifier: orderer
EOF

  echo ">>> Register orderer and admin identities on Org-CA (if not exist)"
  export FABRIC_CA_CLIENT_HOME=${ROOT_PWD}/organizations/ordererOrganizations/esign.com
  # register may fail if already registered; ignore error
  fabric-ca-client register --caname ca-orderer \
    --id.name orderer --id.secret ordererpw --id.type orderer \
    --tls.certfiles "${ROOT_PWD}/ca/ca-orderer/fabric-ca-server-config/tls-cert.pem" || true

  fabric-ca-client register --caname ca-orderer \
    --id.name ordererAdmin --id.secret ordererAdminpw --id.type admin \
    --tls.certfiles "${ROOT_PWD}/ca/ca-orderer/fabric-ca-server-config/tls-cert.pem" || true

  # Enroll orderer MSP
  echo ">>> Enroll orderer MSP"
  fabric-ca-client enroll -u https://orderer:ordererpw@localhost:9054 \
    --caname ca-orderer \
    -M "${ROOT_PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/msp" \
    --csr.hosts orderer.esign.com --csr.hosts localhost \
    --tls.certfiles "${ROOT_PWD}/ca/ca-orderer/fabric-ca-server-config/tls-cert.pem"

  cp "${ROOT_PWD}/organizations/ordererOrganizations/esign.com/msp/config.yaml" \
    "${ROOT_PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/msp/config.yaml"

  # 2) TLS-CA (TLS certs)
  echo ">>> Register & Enroll TLS identity (TLS-CA)"
  TLS_DIR=${ROOT_PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls
  mkdir -p "${TLS_DIR}"

  TLS_CLIENT_HOME=${ROOT_PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/fabric-ca-client
  TLS_CA_CERT="${ROOT_PWD}/ca/ca-tls/data-ca-tls/tls-cert.pem"

  # 2.a Enroll TLS-CA admin (so we can register TLS identities)
  echo ">>> Enroll TLS-CA admin (so we can register TLS identities)"
  export FABRIC_CA_CLIENT_HOME=${TLS_CLIENT_HOME}

  # enroll admin of the TLS CA (use admin:adminpw)
  fabric-ca-client enroll -u https://admin:adminpw@localhost:10054 \
    --caname tlsca-esign \
    --tls.certfiles "${TLS_CA_CERT}" || {
      echo "!! Failed to enroll TLS-CA admin. Make sure TLS CA container is up and reachable at localhost:10054 and TLS_CA_CERT path is correct."
      exit 1
    }

  # 2.b Register TLS identity on TLS-CA (silently ignore "already registered")
  echo ">>> Register TLS identity on TLS-CA"
  fabric-ca-client register --caname tlsca-esign \
    --id.name orderer.esign.com --id.secret orderer-tlspw --id.type orderer \
    --tls.certfiles "${TLS_CA_CERT}" || true

  # 2.c Enroll TLS identity (this creates tlscacerts, signcerts, keystore under TLS_DIR)
  echo ">>> Enroll TLS identity on TLS-CA (produce TLS certs)"
  fabric-ca-client enroll -u https://orderer.esign.com:orderer-tlspw@localhost:10054 \
    --caname tlsca-esign \
    -M "${TLS_DIR}" \
    --enrollment.profile tls \
    --csr.hosts orderer.esign.com \
    --csr.hosts localhost \
    --tls.certfiles "${TLS_CA_CERT}"

  # copy / rename tls artifacts for easy reference by docker-compose
  echo ">>> Copy TLS artifacts to expected filenames"
  cp "${TLS_DIR}"/tlscacerts/*.pem "${TLS_DIR}/ca.crt"
  cp "${TLS_DIR}"/signcerts/*.pem "${TLS_DIR}/server.crt"
  cp "${TLS_DIR}/keystore/"* "${TLS_DIR}/server.key"

  # Ensure OrdererOrg MSP trusts the TLS-CA (required for Raft consenters)
  mkdir -p "${ROOT_PWD}/organizations/ordererOrganizations/esign.com/msp/tlscacerts"
  cp "${ROOT_PWD}/organizations/ordererOrganizations/esign.com/orderers/orderer.esign.com/tls/ca.crt" \
    "${ROOT_PWD}/organizations/ordererOrganizations/esign.com/msp/tlscacerts/tlsca-esign.pem"

  echo ">>> Orderer MSP and TLS enrollment completed!"
}

createOrderer
