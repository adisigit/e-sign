#!/bin/bash

read -r -p "Masukkan orgName: " ORG_NAME
read -r -p "Masukkan token: " TOKEN
read -r -p "Masukkan documentID: " DOCUMENT_ID
read -r -p "Masukkan action: " ACTION
BASE_URL="http://localhost:4000/api/logs"

if [ -z "$ORG_NAME" ] || [ -z "$TOKEN" ] || [ -z "$DOCUMENT_ID" ] || [ -z "$ACTION" ]; then
  echo "Usage: $0 <orgName> <token> <documentID> <action>"
  exit 1
fi

echo "===> Sending POST request to create a private log for org: $ORG_NAME and document: $DOCUMENT_ID"

curl -X POST "$BASE_URL/$ORG_NAME" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"documentID\": \"$DOCUMENT_ID\",
    \"action\": \"$ACTION\"
  }"

echo -e "\n"
