#!/bin/bash

ORG_NAME=$1
TOKEN=$2
DOCUMENT_ID=$3
BASE_URL="http://localhost:4000/api/logs"

if [ -z "$ORG_NAME" ] || [ -z "$TOKEN" ] || [ -z "$DOCUMENT_ID" ]; then
  echo "Usage: $0 <orgName> <token> <documentID>"
  exit 1
fi

echo "===> Sending GET request to get logs for org: $ORG_NAME and document: $DOCUMENT_ID"

curl -X GET "$BASE_URL/org/$ORG_NAME/$DOCUMENT_ID" \
  -H "Authorization: Bearer $TOKEN" \

echo -e "\n"
