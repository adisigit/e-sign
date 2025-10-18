#!/bin/bash

echo "=== CERTIFICATE SUBJECT NAME ANALYSIS ==="
echo "Date: $(date)"
echo ""

echo "=== Checking Peer Certificate Subject Names ==="

echo "Org1 peer0 certificate subject:"
openssl x509 -in organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls/server.crt -text -noout | grep -A 5 "Subject:"
echo ""

echo "Org1 peer0 certificate SAN (Subject Alternative Names):"
openssl x509 -in organizations/peerOrganizations/org1.esign.com/peers/peer0.org1.esign.com/tls/server.crt -text -noout | grep -A 10 "Subject Alternative Name" || echo "No SAN found"
echo ""

echo "Org2 peer0 certificate subject:"
openssl x509 -in organizations/peerOrganizations/org2.esign.com/peers/peer0.org2.esign.com/tls/server.crt -text -noout | grep -A 5 "Subject:"
echo ""

echo "Org2 peer0 certificate SAN (Subject Alternative Names):"
openssl x509 -in organizations/peerOrganizations/org2.esign.com/peers/peer0.org2.esign.com/tls/server.crt -text -noout | grep -A 10 "Subject Alternative Name" || echo "No SAN found"
echo ""

echo "=== What hostnames are peers trying to connect to? ==="
echo "From Docker logs - checking connection attempts:"
docker logs peer0.org1.esign.com 2>&1 | grep -i "deep probe\|connect" | tail -5 || echo "No connection logs found"
docker logs peer0.org2.esign.com 2>&1 | grep -i "deep probe\|connect" | tail -5 || echo "No connection logs found"

echo ""
echo "=== Network Test from Host ==="
echo "Testing if hostnames resolve:"
nslookup peer0.org1.esign.com 2>/dev/null | grep -A 2 "Name:" || echo "peer0.org1.esign.com doesn't resolve"
nslookup peer0.org2.esign.com 2>/dev/null | grep -A 2 "Name:" || echo "peer0.org2.esign.com doesn't resolve"
nslookup localhost 2>/dev/null | grep -A 2 "Name:" || echo "localhost doesn't resolve"