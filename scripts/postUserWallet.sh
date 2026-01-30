#!/bin/bash

read -r -p "Masukkan orgName: " ORG_NAME
read -r -p "Masukkan token: " TOKEN
read -r -p "Masukkan userID: " USER_ID
BASE_URL="http://localhost:3000/api/users/register"

if [ -z "$ORG_NAME" ] || [ -z "$TOKEN" ] || [ -z "$USER_ID" ]; then
  echo "Usage: $0 <orgName> <token> <userID>"
  exit 1
fi

echo "===> Sending POST request to create a user wallet for org: $ORG_NAME"

curl -X POST "$BASE_URL/$ORG_NAME" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"userId\": \"$USER_ID\"
  }"

echo -e "\n"
