#!/usr/bin/env bash
# gen-manifest.sh — Generate a full manifest from gws discovery.
#
# Walks gws services, discovers resources/methods/helpers, pulls schemas,
# and emits a complete manifest YAML. The output is a discovery artifact,
# not the final curated manifest — diff it against src/factory/manifest/
# (one file per service, ADR-304) to see what's new and decide what to expose.
#
# Usage:
#   make manifest-discover              # emit to stdout
#   make manifest-diff                  # diff against curated manifest
#   ./scripts/gen-manifest.sh > discovered.yaml

set -euo pipefail

GWS="npx --yes gws"
INDENT="  "

# Services to discover. Matches gws --help SERVICES section.
# Add new services here as gws adds them.
SERVICES=(gmail calendar drive sheets tasks docs slides people chat)

# Map gws service names to tool names and descriptions
declare -A TOOL_NAMES=(
  [gmail]="manage_email"
  [calendar]="manage_calendar"
  [drive]="manage_drive"
  [sheets]="manage_sheets"
  [tasks]="manage_tasks"
  [docs]="manage_docs"
  [slides]="manage_slides"
  [people]="manage_contacts"
  [chat]="manage_chat"
)

declare -A TOOL_DESCRIPTIONS=(
  [gmail]="Search, read, send, forward, or manage emails"
  [calendar]="List events, view agenda, or manage calendar events"
  [drive]="Search, upload, download, or manage files in Google Drive"
  [sheets]="Read, write, and manage spreadsheets"
  [tasks]="Manage task lists and tasks"
  [docs]="Read and write Google Docs"
  [slides]="Read and write Google Slides presentations"
  [people]="Manage contacts and profiles"
  [chat]="Manage Chat spaces and messages"
)

# Type classification heuristics
classify_method() {
  local method="$1"
  case "$method" in
    list|query) echo "list" ;;
    get|getProfile) echo "detail" ;;
    *) echo "action" ;;
  esac
}

# Parse gws schema JSON to extract params as YAML
emit_params_from_schema() {
  local schema_json="$1"
  # Use node for reliable JSON parsing
  node -e "
    const schema = JSON.parse(process.argv[1]);
    const params = schema.parameters || {};
    const entries = Object.entries(params);
    if (entries.length === 0) process.exit(0);

    for (const [name, def] of entries) {
      // Skip internal/path params that gws handles
      if (name === 'userId' || name === 'key' || name === 'oauth_token' ||
          name === 'prettyPrint' || name === 'quotaUser' || name === 'alt' ||
          name === 'uploadType' || name === 'upload_protocol' || name === 'fields' ||
          name === 'callback' || name === 'access_token') continue;

      const type = def.type === 'integer' ? 'number' : (def.type || 'string');
      const desc = (def.description || '').replace(/\n/g, ' ').slice(0, 120);
      const required = def.required || false;

      console.log('          ' + name + ':');
      console.log('            type: ' + type);
      console.log('            description: \"' + desc.replace(/\"/g, '\\\\\"') + '\"');
      if (required) console.log('            required: true');
      if (def.default) console.log('            default: ' + def.default);
      if (def.enum) console.log('            enum: [' + def.enum.join(', ') + ']');
    }
  " "$schema_json" 2>/dev/null || true
}

# Discover methods for a resource path
# Args: service resource_path (e.g. "gmail" "users.messages")
discover_methods() {
  local service="$1"
  local resource_path="$2"
  local help_args

  # Convert dot path to space-separated args
  IFS='.' read -ra parts <<< "$resource_path"
  help_args="${parts[*]}"

  # Get help output for this resource
  local help_output
  help_output=$($GWS "$service" $help_args --help 2>&1) || return 0

  # Extract methods (lines that look like "  methodName  Description text")
  # Skip sub-resources ("Operations on the '...' resource") and help
  while IFS= read -r line; do
    local method desc
    method=$(echo "$line" | awk '{print $1}')
    desc=$(echo "$line" | sed 's/^[[:space:]]*[^ ]* *//')

    # Skip non-method entries
    [[ "$method" == "help" ]] && continue
    [[ "$desc" == *"Operations on the"* ]] && continue
    [[ -z "$method" ]] && continue

    local op_type
    op_type=$(classify_method "$method")

    # Try to get the schema
    local schema_key="${resource_path}.${method}"
    local schema_json
    schema_json=$($GWS schema "$schema_key" 2>&1) || schema_json=""

    echo "      ${method}:"
    echo "        type: ${op_type}"
    echo "        description: \"${desc}\""
    echo "        resource: ${resource_path}.${method}"

    # Emit params from schema if available
    if [[ -n "$schema_json" ]] && echo "$schema_json" | node -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" 2>/dev/null; then
      local param_output
      param_output=$(emit_params_from_schema "$schema_json")
      if [[ -n "$param_output" ]]; then
        echo "        params:"
        echo "$param_output"
      fi
    fi
    echo ""
  done < <(echo "$help_output" | grep -E '^\s+\w+\s+\S' | grep -v '^\s*$')
}

# Discover helpers for a service
discover_helpers() {
  local service="$1"
  local help_output
  help_output=$($GWS "$service" --help 2>&1) || return 0

  while IFS= read -r line; do
    local helper desc
    helper=$(echo "$line" | awk '{print $1}')
    desc=$(echo "$line" | sed 's/^[[:space:]]*[^ ]* *\[Helper\] *//')

    [[ -z "$helper" ]] && continue

    echo "      ${helper##+}:"
    echo "        type: action"
    echo "        description: \"${desc}\""
    echo "        helper: \"${helper}\""
    echo "        # Run: gws ${service} ${helper} --help for params"
    echo ""
  done < <(echo "$help_output" | grep -E '^\s+\+\w+' | grep -v '^\s*$')
}

# Discover sub-resources recursively
# Args: service parent_path
discover_resources() {
  local service="$1"
  local parent_path="$2"
  local help_args

  IFS='.' read -ra parts <<< "$parent_path"
  help_args="${parts[*]}"

  local help_output
  help_output=$($GWS "$service" $help_args --help 2>&1) || return 0

  # Find sub-resources
  while IFS= read -r line; do
    local resource
    resource=$(echo "$line" | awk '{print $1}')
    [[ "$resource" == "help" ]] && continue
    [[ -z "$resource" ]] && continue

    local sub_path="${parent_path}.${resource}"

    # Emit comment for the sub-resource
    echo "      # --- ${sub_path} ---"

    # Discover methods in this sub-resource
    discover_methods "$service" "$sub_path"

    # Recurse into deeper sub-resources
    discover_resources "$service" "$sub_path"
  done < <(echo "$help_output" | grep -E '^\s+\w+\s+Operations on' | grep -v '^\s*$')
}

# --- Main ---

GWS_VERSION=$($GWS --version 2>&1 | head -1)

echo "# Auto-generated manifest from gws discovery"
echo "# Generated: $(date -Iseconds)"
echo "# ${GWS_VERSION}"
echo "# Compare against src/factory/manifest/ (per-service files) to find new operations"
echo "#"
echo "# Operations marked with # CURATE comments need human review for:"
echo "#   - Description quality (LLM-friendly wording)"
echo "#   - Default values (sensible for agent use)"
echo "#   - Parameter mapping (maps_to, cli_args)"
echo ""
echo "services:"

for service in "${SERVICES[@]}"; do
  tool_name="${TOOL_NAMES[$service]:-manage_${service}}"
  tool_desc="${TOOL_DESCRIPTIONS[$service]:-Manage ${service}}"

  echo ""
  echo "  ${service}:"
  echo "    tool_name: ${tool_name}"
  echo "    description: \"${tool_desc}\""
  echo "    requires_email: true"
  echo "    gws_service: ${service}"
  echo "    operations:"

  # Discover helpers first
  discover_helpers "$service"

  # Get top-level resources
  help_output=$($GWS "$service" --help 2>&1) || continue

  # Find top-level resources (not helpers, not help)
  while IFS= read -r line; do
    resource=$(echo "$line" | awk '{print $1}')
    [[ "$resource" == "help" ]] && continue
    [[ -z "$resource" ]] && continue

    echo "      # --- ${resource} ---"
    discover_methods "$service" "$resource"
    discover_resources "$service" "$resource"
  done < <(echo "$help_output" | grep -E '^\s+\w+\s+Operations on' | grep -v '^\s*$')
done
