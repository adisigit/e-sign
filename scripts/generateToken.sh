#!/bin/bash
# ----------------------------
# generate JWT hanya via sudo
# ----------------------------

if [ "$EUID" -ne 0 ]; then
  echo "Harus dijalankan dengan sudo!"
  exit 1
fi

# Tentukan user asli
USER_HOME=$(eval echo "~$SUDO_USER")

# Ambil versi Node terbaru dari NVM user
NODE_PATH="/usr/bin/node"

# Pastikan node tersedia
if [ ! -x "$NODE_PATH" ]; then
  echo "Node.js tidak ditemukan di $NODE_PATH"
  echo "Pastikan Node.js sudah diinstall via nvm untuk user $SUDO_USER"
  exit 1
fi

# Path absolut ke .env dan node_modules
ENV_FILE="$USER_HOME/e-sign/app/.env"
NODE_MODULES_PATH="$USER_HOME/e-sign/app/node_modules"

if [ ! -f "$ENV_FILE" ]; then
  echo "File $ENV_FILE tidak ditemukan!"
  exit 1
fi

# Load environment variable dari app/.env
set -a
source "$ENV_FILE"
set +a

# Ambil parameter
EMAIL=$1
USER_ID=$2
ROLE=${3:-user}

if [ -z "$EMAIL" ] || [ -z "$USER_ID" ]; then
  echo "Usage: sudo bash scripts/generateToken.sh <email> <user_id> [role]"
  exit 1
fi

# Jalankan Node.js dengan environment yang sudah di-load
sudo -u "$SUDO_USER" NODE_PATH="$NODE_MODULES_PATH" JWT_SECRET="$JWT_SECRET" "$NODE_PATH" -e "
  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET tidak ditemukan di environment.');
    process.exit(1);
  }

  const token = jwt.sign({
    name: '$EMAIL'.split('@')[0],
    email: '$EMAIL',
    preferred_username: '$EMAIL'.split('@')[0],
    user_id: '$USER_ID',
    role: '$ROLE',
  }, secret, { expiresIn: '1h' });

  console.log('\\nToken Generated:\\n');
  console.log(token);
  console.log('\\n');
"
