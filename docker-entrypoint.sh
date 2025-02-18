#!/bin/bash

# Function to log error messages
log_error() {
    echo "[ERROR] $1" >&2
}

# Function to log info messages
log_info() {
    echo "[INFO] $1" >&2
}

# Function to safely create a file with proper permissions
create_secure_file() {
    local file="$1"
    local content="$2"
    umask 027  # Set permissions for new files (640)
    echo "$content" > "$file"
    chmod 640 "$file"  # Ensure file is readable by user and group only
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
        chmod 750 "$dir" || log_info "Directory permissions will be set by Docker volume mount"
    fi
done

# Initialize accounts.json if it doesn't exist
ACCOUNTS_FILE="/app/config/accounts.json"
if [ ! -f "$ACCOUNTS_FILE" ]; then
    log_info "Creating initial accounts.json file"
    create_secure_file "$ACCOUNTS_FILE" '{"accounts":[]}'
    # Ensure proper ownership if running as root
    if [ "$(id -u)" = "0" ]; then
        chown "$DOCKER_USER:$DOCKER_USER" "$ACCOUNTS_FILE" 2>/dev/null || true
    fi
fi

# Directory will be automatically created by Docker volume mount
log_info "Config directory will be mounted at /app/config"

# Let AccountManager handle file creation
log_info "Config directory is ready for AccountManager initialization"

log_info "Config directory is ready at /app/config"

# Trap signals for clean shutdown
trap 'log_info "Shutting down..."; exit 0' SIGTERM SIGINT

# Create logs directory with proper permissions
LOGS_DIR="/app/logs"
if [ ! -d "$LOGS_DIR" ]; then
    log_info "Creating logs directory: $LOGS_DIR"
    mkdir -p "$LOGS_DIR" || {
        log_error "Failed to create logs directory: $LOGS_DIR. This is expected if running as non-root user."
        log_info "Directory will be created by Docker volume mount"
    }
    chmod 750 "$LOGS_DIR" || log_info "Logs directory permissions will be set by Docker volume mount"
fi

# Set MCP mode environment variable
export MCP_MODE=true
export LOG_FILE="/app/logs/google-workspace-mcp.log"

# Execute the main application
exec node build/index.js
