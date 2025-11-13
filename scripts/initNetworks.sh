#!/bin/bash

read -r -p "Masukkan token: " TOKEN
BASE_URL="http://localhost:4000/api/init"

if [ -z "$TOKEN" ]; then
  echo "Usage: $0 <token>"
  exit 1
fi

echo "===> Sending POST request to initialize networks"

curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \

echo -e "\n"
