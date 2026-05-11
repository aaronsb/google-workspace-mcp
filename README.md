# Google Workspace MCP Server

[![npm version](https://img.shields.io/npm/v/@aaronsb/google-workspace-mcp?logo=npm&label=npm)](https://www.npmjs.com/package/@aaronsb/google-workspace-mcp)
[![Latest release](https://img.shields.io/github/v/release/aaronsb/google-workspace-mcp?include_prereleases&label=release)](https://github.com/aaronsb/google-workspace-mcp/releases)
[![Node](https://img.shields.io/node/v/@aaronsb/google-workspace-mcp?logo=node.js&label=node)](https://nodejs.org)
[![License](https://img.shields.io/github/license/aaronsb/google-workspace-mcp)](LICENSE)

Give AI agents full access to Google Workspace — Gmail, Calendar, Drive, and more — through a single MCP server that handles multi-account credential routing, response formatting for AI consumption, and contextual guidance.

Built on [Google's official Workspace CLI](https://github.com/googleworkspace/cli) (`gws`), which means API coverage grows as Google does. The server uses a manifest-driven factory that turns declarative YAML into fully functional MCP tools — adding a new Google API operation is a config change, not a code change.

## Why This MCP Server

**For users:** One install gives your AI agent real, authenticated access to your Google accounts. Search email, check your calendar, manage Drive files, chain multi-step workflows — all through natural conversation.

**For teams:** Multi-account support means your agent can work across personal and work accounts simultaneously, with per-account credential isolation and XDG-compliant storage.

**For developers:** The factory architecture means coverage expands fast. Google's Workspace CLI already supports 15+ services and hundreds of API operations. The manifest curates which ones are exposed, patches add domain-specific formatting, and the defaults handle everything else.

## What's Available

**7 Google-service tools (~80 operations) plus account, batching, and content-authoring tools.** The full surface — what's covered, what isn't, and how it grows — is mapped in **[API coverage](docs/coverage.md)**.

| Tool | What It Does |
|------|--------------|
| `manage_email` | Gmail — search, read (plain or sanitized HTML body), send, reply / reply-all, forward, triage, trash, labels, threads, attachments |
| `manage_calendar` | Calendar — list, agenda, get, create, quickAdd (natural language), update, delete, calendars, freebusy |
| `manage_drive` | Drive — search, get, upload, download, copy, rename / move (`update`), delete, export, permissions, comments, view images |
| `manage_sheets` | Sheets — read / write ranges (row-numbered output), append, clear, manage tabs, copy / duplicate / rename |
| `manage_docs` | Docs — get, create, append, insert text, find-and-replace |
| `manage_tasks` | Tasks — list / create / update / complete tasks and task lists |
| `manage_meet` | Meet — browse past conferences, participants, transcripts, recordings, smart notes |
| `manage_accounts` | Multi-account lifecycle — add accounts, manage credentials and scopes |
| `manage_scratchpad` | Compose / edit multi-line content (line- or JSON-path-addressed), attach files, send to any target; JSON mode live-syncs to Docs / Sheets |
| `manage_workspace` | File operations in the workspace sandbox (exchange point for attachments, downloads, exports) |
| `queue_operations` | Chain operations sequentially with `$N.field` result references |

Every response includes **next-steps** guidance — the agent always knows what it can do next.

## How It Works

```
                          ┌─────────────────────────┐
MCP Client ──stdio──▶     │  manifest/*.yaml         │
                          │  (one file per service)  │
                          └────────┬────────────────┘
                                   │
                          ┌────────▼────────────────┐
                          │  Factory Generator       │
                          │  schemas + handlers      │
                          └────────┬────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │  Gmail   │  │ Calendar │  │  Drive   │
              │  Patch   │  │  Patch   │  │  Patch   │
              └────┬─────┘  └────┬─────┘  └────┬─────┘
                   │             │             │
                   └──────┬──────┘──────┬──────┘
                          ▼             ▼
                    Account Router ──▶ gws CLI ──▶ Google APIs
```

The **factory** reads a YAML manifest and generates MCP tool schemas and request handlers at startup. **Patches** add domain-specific behavior where needed — Gmail search hydration, calendar formatting, Drive file type detection. Operations without patches get sensible defaults automatically.

The underlying engine is Google's `@googleworkspace/cli` — a Rust binary that wraps the full Google Workspace API surface. The MCP server curates which operations to expose and shapes the responses for AI consumption.

## Install

### MCPB Bundle (Claude Desktop and other MCP clients)

Download the `.mcpb` bundle for your platform from the [latest release](https://github.com/aaronsb/google-workspace-mcp/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `google-workspace-mcp-darwin-arm64.mcpb` |
| macOS (Intel) | `google-workspace-mcp-darwin-x64.mcpb` |
| Linux x64 | `google-workspace-mcp-linux-x64.mcpb` |
| Linux ARM64 | `google-workspace-mcp-linux-arm64.mcpb` |
| Windows x64 | `google-workspace-mcp-windows-x64.mcpb` |

In Claude Desktop, drag the `.mcpb` file into the app — it will prompt you for your Google OAuth credentials, then you're ready to go. Other MCP clients that support `.mcpb` extensions can install it the same way. The bundle includes everything: the server, the gws binary, and all dependencies.

### Claude Code / npm

```bash
npm install @aaronsb/google-workspace-mcp
```

Or run directly:

```bash
npx @aaronsb/google-workspace-mcp
```

### Prerequisites

1. **Node.js** 18+
2. **Google Cloud OAuth credentials** — create at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials):
   - Create an OAuth 2.0 Client ID (Desktop application)
   - Enable the APIs you want (Gmail, Calendar, Drive, Sheets, etc.)

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

Add an account (opens browser for OAuth):

```
manage_accounts { "operation": "authenticate" }
```

Then use any tool with your account email:

```
manage_email    { "operation": "triage", "email": "you@gmail.com" }
manage_calendar { "operation": "agenda", "email": "you@gmail.com" }
manage_drive    { "operation": "search", "email": "you@gmail.com", "query": "quarterly report" }
```

### Multi-Step Workflows

Chain operations with result references — the output of one step feeds the next:

```json
{
  "operations": [
    { "tool": "manage_email", "args": { "operation": "search", "email": "you@gmail.com", "query": "from:boss subject:review" }},
    { "tool": "manage_email", "args": { "operation": "read", "email": "you@gmail.com", "messageId": "$0.messageId" }}
  ]
}
```

## Expanding Coverage

The server discovers operations from the gws CLI, which already supports 15+ Google services (Sheets, Docs, Tasks, People, Chat, and more). Adding coverage is a manifest edit:

```bash
make manifest-discover   # Find all 287+ available operations
make manifest-lint       # Validate the curated manifest
make test                # Verify everything works
```

New operations get default formatting automatically. Add a patch only when you need domain-specific presentation.

## Data Storage

Follows XDG Base Directory Specification:

| Data | Location |
|------|----------|
| Account registry | `~/.config/google-workspace-mcp/accounts.json` |
| Credentials | `~/.local/share/google-workspace-mcp/credentials/` |

Credentials are per-account files with standard OAuth tokens. No secrets are stored in the project directory.

## License

MIT
