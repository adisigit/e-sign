#!/bin/bash

read -r -p "Masukkan orgName: " ORG_NAME
read -r -p "Masukkan token: " TOKEN
read -r -p "Masukkan documentID: " DOCUMENT_ID
BASE_URL="http://localhost:3000/api/logs/webhook/org"

if [ -z "$ORG_NAME" ] || [ -z "$DOCUMENT_ID" ] || [ -z "$TOKEN" ]; then
  echo "Usage: $0 <orgName> <token> <documentID>"
  exit 1
fi

echo "===> Sending GET request to get logs for org: $ORG_NAME and document: $DOCUMENT_ID"

curl -X GET "$BASE_URL/$ORG_NAME/$DOCUMENT_ID" \
  -H "Authorization: Bearer $TOKEN"

echo -e "\n"
