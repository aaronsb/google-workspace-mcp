#!/bin/bash

# Function to log error messages
log_error() {
    echo "[ERROR] $1" >&2
}

# Function to log info messages
log_info() {
    echo "[INFO] $1"
}

# Check if config directory is mounted and writable
if [ ! -d "/app/config" ]; then
    log_error "Config directory /app/config is not mounted."
    log_error "Please ensure you have:"
    log_error "1. Created a local config directory for storing sensitive data"
    log_error "2. Mounted it correctly using: -v /path/to/your/config:/app/config"
    log_error ""
    log_error "Recommended: Use ~/.mcp/google-workspace-mcp as your config location"
    log_error "Example: mkdir -p ~/.mcp/google-workspace-mcp"
    exit 1
fi

if [ ! -w "/app/config" ]; then
    log_error "Config directory /app/config is not writable."
    log_error "Please check permissions on your config directory"
    log_error "The directory must be writable by the container user"
    exit 1
fi

# Create credentials directory if it doesn't exist
mkdir -p /app/config/credentials
log_info "Ensuring credentials directory exists at /app/config/credentials"

# Create gauth.json if it doesn't exist and credentials are provided
if [ ! -f /app/config/gauth.json ] && [ ! -z "$GOOGLE_CLIENT_ID" ] && [ ! -z "$GOOGLE_CLIENT_SECRET" ]; then
    log_info "Creating initial gauth.json with provided credentials"
    cat > /app/config/gauth.json << EOF
{
  "client_id": "$GOOGLE_CLIENT_ID",
  "client_secret": "$GOOGLE_CLIENT_SECRET",
  "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
EOF
elif [ ! -f /app/config/gauth.json" ]; then
    log_error "gauth.json not found and OAuth credentials not provided"
    log_error "Please provide GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables"
    exit 1
fi

# Create empty accounts.json if it doesn't exist
if [ ! -f /app/config/accounts.json" ]; then
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
