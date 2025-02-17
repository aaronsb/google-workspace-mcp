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
        mkdir -p "$dir" || {
            log_error "Failed to create directory: $dir. This is expected if running as non-root user."
            log_info "Directory will be created by Docker volume mount"
        }
    fi
done

# Directory will be automatically created by Docker volume mount
log_info "Config directory will be mounted at /app/config"

# Initialize accounts.json if it doesn't exist
if [ ! -f "/app/config/accounts.json" ]; then
    log_info "Creating initial accounts.json"
    create_secure_file "/app/config/accounts.json" '{"accounts":[]}' || {
        log_error "Failed to create accounts.json. Please check permissions."
        exit 1
    }
fi

# Create credentials directory if it doesn't exist
mkdir -p "/app/config/credentials" || {
    log_error "Failed to create credentials directory. Please check permissions."
    exit 1
}

log_info "Config directory is ready at /app/config"

# Trap signals for clean shutdown
trap 'log_info "Shutting down..."; exit 0' SIGTERM SIGINT

# Execute the main application
exec node build/index.js
