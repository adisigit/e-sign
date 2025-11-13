#!/bin/bash

read -r -p "Masukkan orgName: " ORG_NAME
read -r -p "Masukkan token: " TOKEN
read -r -p "Masukkan documentID: " DOCUMENT_ID
read -r -p "Masukkan documentName: " DOCUMENT_NAME
read -r -p "Masukkan status: " STATUS
BASE_URL="http://localhost:4000/api/documents"

if [ -z "$ORG_NAME" ] || [ -z "$TOKEN" ] || [ -z "$DOCUMENT_ID" ] || [ -z "$DOCUMENT_NAME" ] || [ -z "$STATUS" ]; then
  echo "Usage: $0 <orgName> <token> <documentID> <documentName> <status>"
  exit 1
fi

echo "===> Sending POST request to create a private document for org: $ORG_NAME"

curl -X POST "$BASE_URL/$ORG_NAME" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"documentID\": \"$DOCUMENT_ID\",
    \"documentName\": \"$DOCUMENT_NAME\",
    \"status\": \"$STATUS\"
  }"

echo -e "\n"
