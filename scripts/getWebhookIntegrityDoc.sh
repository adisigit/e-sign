#!/bin/bash

read -r -p "Masukkan orgName: " ORG_NAME
read -r -p "Masukkan documentID: " DOCUMENT_ID
BASE_URL="http://localhost:4000/api/document/webhook/org"

if [ -z "$ORG_NAME" ] || [ -z "$DOCUMENT_ID" ]; then
  echo "Usage: $0 <orgName> <documentID>"
  exit 1
fi

echo "===> Sending GET request to get logs for org: $ORG_NAME and document: $DOCUMENT_ID"

curl -X GET "$BASE_URL/$ORG_NAME/integrity/$DOCUMENT_ID" 

echo -e "\n"
