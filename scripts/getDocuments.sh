#!/bin/bash

read -r -p "Masukkan orgName: " ORG_NAME
read -r -p "Masukkan token: " TOKEN
BASE_URL="http://localhost:4000/api/documents"

if [ -z "$ORG_NAME" ] || [ -z "$TOKEN" ]; then
  echo "Usage: $0 <orgName> <token>"
  exit 1
fi

echo "===> Sending GET request to get documents for org: $ORG_NAME"

curl -X GET "$BASE_URL/org/$ORG_NAME" \
  -H "Authorization: Bearer $TOKEN" \

echo -e "\n"
