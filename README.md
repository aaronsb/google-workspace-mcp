# Google Workspace MCP Server

[![npm version](https://img.shields.io/npm/v/@aaronsb/google-workspace-mcp?logo=npm&label=npm)](https://www.npmjs.com/package/@aaronsb/google-workspace-mcp)
[![Latest release](https://img.shields.io/github/v/release/aaronsb/google-workspace-mcp?include_prereleases&label=release)](https://github.com/aaronsb/google-workspace-mcp/releases)
[![Node](https://img.shields.io/node/v/@aaronsb/google-workspace-mcp?logo=node.js&label=node)](https://nodejs.org)
[![License](https://img.shields.io/github/license/aaronsb/google-workspace-mcp)](LICENSE)

Give AI agents real access to Google Workspace — Gmail, Calendar, Drive, Docs, Sheets, Tasks, and Meet — through a single MCP server that handles multi-account credential routing, response shaping for AI consumption, and contextual next-step guidance.

The server talks to Google's REST APIs directly, through a client it builds **from Google's own machine-readable API specifications**. Google publishes a [Discovery document](https://developers.google.com/discovery) for every API; a build step reads them and generates the descriptor this server dispatches against. Google's API surface *is* the source of truth — not a hand-maintained wrapper, and not a third-party CLI.

## Why This MCP Server

**For users:** One install gives your agent authenticated access to your Google accounts. Search email, check your calendar, manage Drive files, chain multi-step workflows — through natural conversation.

**For teams:** Multi-account support lets one agent work across personal and work accounts at once, with per-account credential isolation and XDG-compliant storage.

**For developers:** Adding an operation is a YAML edit, not a code change. The manifest curates which of Google's methods to expose; the generated descriptor already knows every method's path, HTTP verb, parameters, and scopes. Nothing is transcribed by hand, so nothing drifts from Google.

## What's Available

**11 tools — 7 Google services (80 operations), plus accounts, batching, content authoring, and a file sandbox.**

| Tool | What It Does |
|------|--------------|
| `manage_email` | Gmail — search, read (plain or sanitized HTML), send, reply / reply-all, forward, triage, trash, labels, threads, attachments |
| `manage_calendar` | Calendar — list, agenda, get, create, quickAdd (natural language), update, delete, calendars, freebusy |
| `manage_drive` | Drive — search, get, upload, download, copy, rename / move, delete, export, permissions, comments, view images |
| `manage_sheets` | Sheets — read / write ranges (row-numbered output), append, clear, manage tabs, copy / duplicate / rename |
| `manage_docs` | Docs — get, create, append, insert text, find-and-replace |
| `manage_tasks` | Tasks — list / create / update / complete tasks and task lists |
| `manage_meet` | Meet — browse past conferences, participants, transcripts, recordings, smart notes |
| `manage_accounts` | Multi-account lifecycle — add accounts, manage credentials and scopes |
| `manage_scratchpad` | Compose / edit multi-line content (line- or JSON-path-addressed), attach files, send to any target; JSON mode live-syncs to Docs / Sheets |
| `manage_workspace` | File operations in the workspace sandbox (exchange point for attachments, downloads, exports) |
| `queue_operations` | Chain operations sequentially with `$N.field` result references |

Every response carries **next-steps** guidance, so the agent always knows what it can do next.

Those 80 operations reach 60 of the 233 methods Google publishes across these seven APIs.

**Missing something you need?** The rest of the surface is mapped, not guessed. **[Browse every method Google publishes](docs/api-surface.md)** — what it does, whether we expose it, and a one-click link to request it. The descriptions are Google's own, and the page is generated from the same specification the client is built from, so it can't drift.

The subset is curated on purpose: an agent has to *choose* among these, and every method it must weigh is one it can pick wrongly. But that judgement was made without you — if it's wrong for your case, **[say so](docs/coverage.md)**. A good request names the task, not the method.

## How It Works

Two phases. Google's API specification is acquired at **build time** and frozen into a committed artifact; at **runtime** the server only reads it.

### Build time — acquire the specification

```mermaid
flowchart LR
    disco["Google Discovery<br>documents"] --> gen["descriptor generator<br>generate-descriptor.mjs"]
    gen --> desc[("src/google/descriptor.json<br>233 methods · committed<br>paths · verbs · params · scopes")]
    desc --> gate{{"CI drift gate<br>regenerate and compare"}}

    classDef external fill:#f6821f,color:#1a1a1a,stroke:#d97706
    classDef process  fill:#2d7d9a,color:#ffffff,stroke:#4a5568
    classDef artifact fill:#2d8e5e,color:#ffffff,stroke:#4a5568
    classDef guard    fill:#fbbf24,color:#1a1a1a,stroke:#d97706
    class disco external
    class gen process
    class desc artifact
    class gate guard
```

### Runtime — dispatch against it

```mermaid
flowchart LR
    mcp["MCP client"] -->|stdio| factory["factory generator<br>schemas + handlers"]
    manifest["manifest/*.yaml<br>which ops to expose"] --> factory
    factory --> patches["patches<br>Gmail hydration · agenda merge · MIME"]
    patches --> client["Google API client<br>+ account router"]
    desc[("descriptor.json")] -. read at startup .-> client
    client --> google["Google REST APIs"]

    classDef external fill:#f6821f,color:#1a1a1a,stroke:#d97706
    classDef artifact fill:#2d8e5e,color:#ffffff,stroke:#4a5568
    classDef config   fill:#fbbf24,color:#1a1a1a,stroke:#d97706
    classDef core     fill:#7c3aed,color:#ffffff,stroke:#8b5cf6
    classDef inert    fill:#475569,color:#ffffff,stroke:#94a3b8
    class google external
    class desc artifact
    class manifest config
    class factory,patches,client core
    class mcp inert
```

**The descriptor** is generated from Google's Discovery documents and committed. A CI drift gate re-generates it and fails if the result differs, so the spec we dispatch against cannot silently fall behind Google.

**The client** (`src/google/client.ts`) is deliberately opinion-free: it builds the request Google's spec describes and returns exactly what Google returned. It does not reshape responses. All interpretation lives in patches and formatters, aimed at the MCP contract — which is what keeps "what Google said" and "what we chose to show" separable.

**The factory** reads the YAML manifest and generates MCP tool schemas and handlers at startup. **Patches** add behavior where an agent needs more than a raw API response — hydrating Gmail search results with senders and subjects, merging an agenda across calendars, building MIME for outbound mail. Operations without a patch get sensible defaults.

Because method names are generated into a TypeScript union, calling a method Google doesn't publish is a **compile error**, not a 404 at runtime.

## Install

First, you need **Google OAuth credentials** — the one prerequisite common to every path:

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID**, application type **Desktop app**
3. Enable the APIs you want (Gmail, Calendar, Drive, Sheets, Docs, Tasks, Meet)
4. Keep the **Client ID** and **Client Secret** handy — you'll paste them in below

Then pick the path that matches how you work. All three run the same server.

Node 22.12 or newer. (Node 18 and 20 are both end-of-life.)

---

### 📦 → 🤖 Claude Desktop — one-click `.mcpb` install (recommended)

Download **`google-workspace-mcp.mcpb`** from the [latest release](https://github.com/aaronsb/google-workspace-mcp/releases/latest), then **drag it onto the Claude Desktop window**, or double-click it.

Claude Desktop opens an install dialog with three fields:

| Field | |
|---|---|
| **Google OAuth Client ID** | required — from the step above |
| **Google OAuth Client Secret** | required — from the step above |
| **Workspace Directory** | optional — where attachments, downloads and exports land. Defaults to `~/.local/share/google-workspace-mcp/workspace/`. Give it a dedicated folder — not your home, Documents, Desktop, or a Google Drive folder. |

Paste, hit Save, done. No JSON to edit, no Node to install, no paths to get right — the bundle carries the server and every dependency.

**One bundle covers every platform** — macOS (Intel and Apple Silicon), Linux (x64 and ARM64), and Windows. There is nothing to choose: the server is pure JavaScript, so there is no platform-specific payload to pick between.

> *Cross-platform note:* `.mcpb` files install via Claude Desktop's bundled handler. If double-clicking doesn't trigger Claude on your system, drag the file onto the Claude Desktop window instead, or right-click → "Open with…" and pick Claude Desktop (then "always open with" if your OS offers). Behavior varies: macOS usually auto-associates, Windows may need a one-time association, Linux varies by desktop environment.

---

### Claude Code — one command

```bash
claude mcp add google-workspace \
  -e GOOGLE_CLIENT_ID=your-client-id \
  -e GOOGLE_CLIENT_SECRET=your-client-secret \
  -- npx -y @aaronsb/google-workspace-mcp
```

That's it — no file to edit. Verify with `/mcp`.

---

### Other MCP clients

Add an entry to the client's MCP config file (for Claude Desktop by hand, that's `claude_desktop_config.json`; for Claude Code, `.mcp.json`):

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "npx",
      "args": ["-y", "@aaronsb/google-workspace-mcp"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Or install it globally and point at the binary directly:

```bash
npm install -g @aaronsb/google-workspace-mcp
```

## Usage

Add an account (opens a browser for OAuth):

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

The coverage mapper diffs what the manifest exposes against what Google actually publishes, so the frontier is always measured rather than estimated:

```bash
npm run generate-descriptor   # re-read Google's Discovery documents
make coverage                 # what we expose vs. what Google offers
make manifest-lint            # validate the curated manifest
make check                    # type-check, lint, test, build, smoke
```

To expose a new operation, add it to the relevant `src/factory/manifest/*.yaml`. The descriptor already knows its path, verb, parameters, and scopes, and the factory generates the tool schema and handler. New operations get default formatting automatically — add a patch only when an agent needs a shaped response rather than a raw one.

## Data Storage

Follows the XDG Base Directory Specification:

| Data | Location |
|------|----------|
| Account registry | `~/.config/google-workspace-mcp/accounts.json` |
| Credentials | `~/.local/share/google-workspace-mcp/credentials/` |
| Workspace (file exchange) | `~/.local/share/google-workspace-mcp/workspace/` |

Credentials are per-account files holding standard OAuth tokens. No secrets are stored in the project directory.

## Design

The server generates its API client from Google's own Discovery documents and calls Google directly. Nothing sits between the server and the API it targets: there is no subprocess, no second response shape, and no unversioned wrapper to keep in step. The descriptor is regenerated and diffed against Google on every build, so a method that does not exist is a compile error rather than a runtime surprise.

On top of that sits the manifest-driven tool factory: adding an operation is a YAML edit, not a code change. The coverage mapper reads Google's real published surface, so "what we expose vs what exists" is a measured number.

The reasoning behind this design, including what was verified and what it cost, is in **[ADR-103](docs/architecture/core/ADR-103-generate-a-google-api-descriptor-retire-the-gws-facade.md)**.

## License

[Apache License 2.0](LICENSE).

Through v3.0.0 this project was MIT-licensed. Those contributions keep their original
notice (`LICENSE-MIT`), and the contributors are credited in [`NOTICE`](NOTICE). Apache 2.0
adds an explicit patent grant and a state-your-changes requirement; it does not take back
anything MIT permitted.
