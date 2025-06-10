#!/bin/bash
set -e

# Force immediate output
exec 1>&1

# This script provides a lightweight local development build pipeline
# that mirrors our CI approach but optimized for speed and local iteration.
# It performs all build steps from linting through Docker image creation,
# providing minimal but clear status output.

# Parse command line arguments
VERBOSE=false
IMAGE_TAG="google-workspace-mcp:local"
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --verbose) VERBOSE=true ;;
        --tag) IMAGE_TAG="$2"; shift ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Create temp directory for logs if it doesn't exist
TEMP_DIR="/tmp/google-workspace-mcp"
mkdir -p "$TEMP_DIR"

# Setup colored output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color
CHECK_MARK="✓"
X_MARK="✗"
WARNING_MARK="⚠"

# Function to check log file size and show warning if needed
check_log_size() {
    local log_file=$1
    if [ -f "$log_file" ]; then
        local line_count=$(wc -l < "$log_file")
        if [ $line_count -gt 100 ]; then
            echo -e "${YELLOW}${WARNING_MARK} Large log file detected ($line_count lines)${NC}"
            echo "  Tips for viewing large logs:"
            echo "  • head -n 20 $log_file     (view first 20 lines)"
            echo "  • tail -n 20 $log_file     (view last 20 lines)"
            echo "  • less $log_file           (scroll through file)"
            echo "  • grep 'error' $log_file   (search for specific terms)"
            echo "  • use pageless mode with tools when viewing files"
        fi
    fi
}

# Function to run a step and show its status
run_step() {
    local step_name=$1
    local log_file="$TEMP_DIR/$2.log"
    local command=$3

    echo -n "→ $step_name... "

    if [ "$VERBOSE" = true ]; then
        if eval "$command"; then
            echo -e "${GREEN}${CHECK_MARK} Success${NC}"
            return 0
        else
            echo -e "${RED}${X_MARK} Failed${NC}"
            return 1
        fi
    else
        if eval "$command > '$log_file' 2>&1"; then
            echo -e "${GREEN}${CHECK_MARK} Success${NC} (log: $log_file)"
            check_log_size "$log_file"
            return 0
        else
            echo -e "${RED}${X_MARK} Failed${NC} (see details in $log_file)"
            check_log_size "$log_file"
            return 1
        fi
    fi
}

# Install dependencies
run_step "Installing dependencies" "npm-install" "npm install" || exit 1

# Type check
run_step "Type checking" "type-check" "npm run type-check" || exit 1

# Run linting
run_step "Linting" "lint" "npm run lint" || exit 1

# Run tests (commented out since they're a placeholder)
# run_step "Testing" "test" "npm run test || true"

# Build TypeScript
run_step "Building TypeScript" "build" "npm run build" || exit 1

# Build Docker image using the local Dockerfile
echo "→ Building Docker image..."
if [ "$VERBOSE" = true ]; then
    if docker build -t "$IMAGE_TAG" -f "Dockerfile.local" .; then
        echo -e "${GREEN}${CHECK_MARK} Docker build successful${NC}"
    else
        echo -e "${RED}${X_MARK} Docker build failed${NC}"
        exit 1
    fi
else
    DOCKER_LOG="$TEMP_DIR/docker-build.log"
    if docker build -t "$IMAGE_TAG" -f "Dockerfile.local" . > "$DOCKER_LOG" 2>&1; then
        echo -e "${GREEN}${CHECK_MARK} Docker build successful${NC} (log: $DOCKER_LOG)"
        check_log_size "$DOCKER_LOG"
    else
        echo -e "${RED}${X_MARK} Docker build failed${NC} (see details in $DOCKER_LOG)"
        check_log_size "$DOCKER_LOG"
        exit 1
    fi
fi

echo -e "\n${GREEN}Build complete!${NC} Image tagged as $IMAGE_TAG"
echo "To change the image tag, use: ./scripts/build-local.sh --tag <your-tag>"
echo "This build uses Dockerfile.local which is optimized for local development."
