# Google Workspace MCP Server

An MCP server for Google Workspace that gives AI agents access to Gmail, Calendar, and Drive through a clean, operation-based interface with multi-account support.

Built on top of Google's official [`@googleworkspace/cli`](https://github.com/googleworkspace/cli) (gws) — all API coverage comes from Google's own tooling, dynamically discovered and always up to date.

## What It Does

**5 tools, 17 operations:**

| Tool | Operations | Description |
|------|-----------|-------------|
| `manage_accounts` | list, authenticate, remove | Multi-account management |
| `manage_email` | search, read, send, reply, triage | Gmail with search syntax |
| `manage_calendar` | list, agenda, create, get, delete | Calendar management |
| `manage_drive` | search, upload, get, download | Drive file operations |
| `queue_operations` | — | Chain operations with `$N.field` result references |

Each response includes contextual **next-steps** guidance, helping agents discover follow-up actions naturally.

## Install

```bash
npm install @aaronsb/google-workspace-mcp
```

Or run directly:

```bash
npx @aaronsb/google-workspace-mcp
```

This installs everything — the gws Rust CLI binary comes along as a dependency.

### Prerequisites

1. **Node.js** 18+
2. **Google Cloud OAuth credentials** — create at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials):
   - Create an OAuth 2.0 Client ID (Desktop application)
   - Enable Gmail, Calendar, and Drive APIs

3. Set environment variables:
   ```bash
   export GOOGLE_CLIENT_ID="your-client-id"
   export GOOGLE_CLIENT_SECRET="your-client-secret"
   ```

## MCP Client Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "npx",
      "args": ["@aaronsb/google-workspace-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### Claude Code

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "npx",
      "args": ["@aaronsb/google-workspace-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Usage

Start by listing accounts:

```
manage_accounts { "operation": "list" }
```

Add an account (opens browser for OAuth):

```
manage_accounts { "operation": "authenticate" }
```

Then use any tool with your account email:

```
manage_email { "operation": "triage", "email": "you@gmail.com" }
manage_calendar { "operation": "agenda", "email": "you@gmail.com" }
manage_drive { "operation": "search", "email": "you@gmail.com", "query": "quarterly report" }
```

### Queue Operations

Chain multiple operations in one call with result references:

```json
{
  "operations": [
    { "tool": "manage_email", "args": { "operation": "search", "email": "you@gmail.com", "query": "from:boss subject:review" } },
    { "tool": "manage_calendar", "args": { "operation": "agenda", "email": "you@gmail.com" } }
  ]
}
```

## Architecture

```
MCP Client → stdio → Server → Handler → gws CLI → Google APIs
                                  ↓
                          Account Registry (multi-account credential routing)
```

- **Executor** — spawns `gws` as a subprocess with per-account credential routing
- **Credential bridge** — exports from gws encrypted store to per-account files in XDG-compliant paths
- **Formatting** — shapes raw API responses for AI context efficiency
- **Next-steps** — contextual follow-up suggestions in every response

## Data Storage

Follows XDG Base Directory Specification:

| Data | Location |
|------|----------|
| Account registry | `~/.config/google-workspace-mcp/accounts.json` |
| Credentials | `~/.local/share/google-workspace-mcp/credentials/` |

## Development

```bash
npm install
make build        # Compile TypeScript
make typecheck    # Type checking only
make test-unit    # Run unit tests (60 tests)
make test         # Same as test-unit
```

## License

MIT
