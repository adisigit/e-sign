#!/bin/bash

function enrollCAAdmin() {
  local ORG=$1
  local DOMAIN=$2
  local PORT=$3

  echo ">> Enrolling the CA admin for ${ORG}.${DOMAIN}..."

  export FABRIC_CA_CLIENT_HOME="organizations/${ORG}Organizations/${ORG}.${DOMAIN}/"

  fabric-ca-client enroll -u https://admin:adminpw@localhost:"${PORT}" \
    --caname "ca-${ORG}" \
    --tls.certfiles "ca/ca-${ORG}/data-${ORG}/tls-cert.pem"
}

function registerPeer() {
  local ORG=$1
  local DOMAIN=$2
  local PORT=$3

  echo ">> Registering peer0 for ${ORG}.${DOMAIN}..."

  export FABRIC_CA_CLIENT_HOME="organizations/${ORG}Organizations/${ORG}.${DOMAIN}/"

  fabric-ca-client register --caname ca-${ORG} --id.name peer0 --id.secret peer0pw --id.type peer \
    --tls.certfiles "ca/ca-${ORG}/data-${ORG}/tls-cert.pem"
}

function registerPeer1() {
  local ORG=$1
  local DOMAIN=$2
  local PORT=$3

  echo ">> Registering peer1 for ${ORG}.${DOMAIN}..."

  export FABRIC_CA_CLIENT_HOME="organizations/${ORG}Organizations/${ORG}.${DOMAIN}/"

  fabric-ca-client register --caname ca-${ORG} --id.name peer1 --id.secret peer1pw --id.type peer \
    --tls.certfiles "ca/ca-${ORG}/data-${ORG}/tls-cert.pem"
}

function registerUser() {
  local ORG=$1
  local DOMAIN=$2
  local PORT=$3

  echo ">> Registering user1 for ${ORG}.${DOMAIN}..."

  export FABRIC_CA_CLIENT_HOME="organizations/${ORG}Organizations/${ORG}.${DOMAIN}/"

  fabric-ca-client register --caname ca-${ORG} --id.name user1 --id.secret user1pw --id.type client \
    --tls.certfiles "ca/ca-${ORG}/data-${ORG}/tls-cert.pem"
}

function registerOrgAdmin() {
  local ORG=$1
  local DOMAIN=$2
  local PORT=$3

  echo ">> Registering ${ORG}admin for ${ORG}.${DOMAIN}..."

  export FABRIC_CA_CLIENT_HOME="organizations/${ORG}Organizations/${ORG}.${DOMAIN}/"

  fabric-ca-client register --caname "ca-${ORG}" --id.name "${ORG}admin" --id.secret "${ORG}adminpw" --id.type admin \
    --tls.certfiles "ca/ca-${ORG}/data-${ORG}/tls-cert.pem"
}

function registerOrderer() {
  local ORG=orderer
  local DOMAIN=$1
  local PORT=$2

  echo ">> Registering orderer and ordererAdmin for ${DOMAIN}..."

  export FABRIC_CA_CLIENT_HOME="organizations/${ORG}Organizations/${DOMAIN}/"

  fabric-ca-client register --caname "ca-${ORG}" --id.name orderer --id.secret ordererpw --id.type orderer \
    --tls.certfiles "ca/ca-${ORG}/data-${ORG}/tls-cert.pem"

  fabric-ca-client register --caname "ca-${ORG}" --id.name ordererAdmin --id.secret ordererAdminpw --id.type admin \
    --tls.certfiles "ca/ca-${ORG}/data-${ORG}/tls-cert.pem"
}
