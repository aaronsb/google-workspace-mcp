#!/bin/bash

# Function to log error messages
log_error() {
    echo "[ERROR] $1" >&2
}

# Function to log info messages
log_info() {
    echo "[INFO] $1"
}

# Function to safely create a file with proper permissions
create_secure_file() {
    local file="$1"
    local content="$2"
    umask 077  # Set strict permissions for new files
    echo "$content" > "$file"
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

# Ensure config directories exist with proper permissions
for dir in "/app/config" "/app/config/credentials"; do
    if [ ! -d "$dir" ]; then
        log_info "Creating directory: $dir"
        mkdir -p "$dir"
    fi
done

# Create gauth.json with provided credentials
log_info "Creating gauth.json with provided credentials"
create_secure_file "/app/config/gauth.json" "{
  \"client_id\": \"$GOOGLE_CLIENT_ID\",
  \"client_secret\": \"$GOOGLE_CLIENT_SECRET\",
  \"redirect_uri\": \"urn:ietf:wg:oauth:2.0:oob\",
  \"auth_uri\": \"https://accounts.google.com/o/oauth2/auth\",
  \"token_uri\": \"https://oauth2.googleapis.com/token\"
}"

# Create empty accounts.json if it doesn't exist
if [ ! -f "/app/config/accounts.json" ]; then
    log_info "Creating initial accounts.json"
    create_secure_file "/app/config/accounts.json" '{"accounts":[]}'
fi

log_info "Config directory is ready at /app/config"

# Trap signals for clean shutdown
trap 'log_info "Shutting down..."; exit 0' SIGTERM SIGINT

# Execute the main application
exec node build/index.js
