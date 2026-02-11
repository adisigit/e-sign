#!bin/bash

read -r -p "Masukkan orgName: " ORG_NAME
read -r -p "Masukkan token: " TOKEN
read -r -p "Masukkan documentID: " DOCUMENT_ID
read -r -p "Masukkan file (base64): " FILE_BASE64
BASE_URL="http://localhost:3000/api/document/webhook/$ORG_NAME/integrity"

if [ -z "$ORG_NAME" ] || [ -z "$DOCUMENT_ID" ] || [ -z "$TOKEN" ] || [ -z "$FILE_BASE64" ]; then
  echo "Usage: $0 <orgName> <token> <documentID> <file>"
  exit 1
fi

echo "===> Sending POST request to check document user for org: $ORG_NAME and document: $DOCUMENT_ID"

curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"id\": \"$DOCUMENT_ID\",
    \"file\": \"$FILE_BASE64\"
  }"

echo -e "\n"