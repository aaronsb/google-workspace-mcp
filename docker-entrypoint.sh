#!/bin/bash

# Function to log error messages
log_error() {
    echo "[ERROR] $1" >&2
}

# Function to log info messages
log_info() {
    echo "[INFO] $1"
}

# Validate required environment variables
if [ -z "$GOOGLE_CLIENT_ID" ]; then
    log_error "GOOGLE_CLIENT_ID environment variable is required"
    exit 1
fi

if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
    log_error "GOOGLE_CLIENT_SECRET environment variable is required"
    exit 1
fi

# Create config directory if it doesn't exist
mkdir -p /app/config || {
    log_error "Failed to create config directory"
    exit 1
}

# Create necessary subdirectories and files
mkdir -p /app/config/credentials
log_info "Created credentials directory at /app/config/credentials"

# Create gauth.json with provided credentials
log_info "Creating gauth.json with provided credentials"
cat > /app/config/gauth.json << EOF
{
  "client_id": "$GOOGLE_CLIENT_ID",
  "client_secret": "$GOOGLE_CLIENT_SECRET",
  "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
EOF

# Create empty accounts.json if it doesn't exist
if [ ! -f "/app/config/accounts.json" ]; then
    log_info "Creating initial accounts.json"
    echo '{"accounts":[]}' > /app/config/accounts.json
fi

# Ensure proper permissions on config files
log_info "Setting secure file permissions"
chmod 600 /app/config/gauth.json 2>/dev/null || log_error "Failed to set permissions on gauth.json"
chmod 600 /app/config/accounts.json 2>/dev/null || log_error "Failed to set permissions on accounts.json"
chmod 700 /app/config/credentials 2>/dev/null || log_error "Failed to set permissions on credentials directory"

log_info "Config directory is ready at /app/config"

# Execute the main application
exec node build/index.js
