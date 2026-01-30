#!/bin/bash

read -r -p "Masukkan orgName (default: org1): " ORG_NAME
ORG_NAME=${ORG_NAME:-org1}

read -r -p "Masukkan document ID: " DOCUMENT_ID
read -r -p "Masukkan document category code: " DOC_CATEGORY
read -r -p "Masukkan name: " NAME
read -r -p "Masukkan description: " DESCRIPTION
read -r -p "Masukkan file (base64): " FILE_BASE64
read -r -p "Masukkan userId (default: admin): " USER_ID
USER_ID=${USER_ID:-admin}

BASE_URL="http://localhost:3000/api/webhook"

if [ -z "$DOCUMENT_ID" ] || [ -z "$DOC_CATEGORY" ] || [ -z "$NAME" ] || [ -z "$DESCRIPTION" ] || [ -z "$FILE_BASE64" ]; then
  echo "Field wajib belum diisi"
  exit 1
fi

echo "===> Sending webhook to org: $ORG_NAME"

curl -X POST "$BASE_URL/$ORG_NAME" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$DOCUMENT_ID\",
    \"documentCategoryCode\": \"$DOC_CATEGORY\",
    \"name\": \"$NAME\",
    \"description\": \"$DESCRIPTION\",
    \"file\": \"$FILE_BASE64\",
    \"userId\": \"$USER_ID\",
    \"recipients\": [
      {
        \"userId\": \"user-001\",
        \"name\": \"Budi\",
        \"userRoleCode\": \"CREATOR\",
        \"recipientRoleCode\": \"APPROVER\"
      },
      {
        \"userId\": \"user-002\",
        \"name\": \"Siti\",
        \"userRoleCode\": \"APPROVER\",
        \"recipientRoleCode\": \"VIEWER\"
      }
    ]
  }"

echo -e "\n"
