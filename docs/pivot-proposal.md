# Pivot Proposal: MCP Context Layer over Google Workspace CLI

**Date:** 2026-03-12
**Status:** Discussion draft — not a commitment

## Problem

Google shipped `@googleworkspace/cli` (gws) — a Rust CLI that dynamically discovers and wraps every Workspace API via Google's Discovery Service. It includes 24 helper commands, structured output, encrypted credential storage, and auto-pagination. At v0.13.1 it's actively maintained under Apache-2.0.

Our project manually maintains TypeScript wrappers around a subset of these same APIs (Gmail, Calendar, Drive, Contacts). Every time Google changes an API surface, we update by hand. We're doing work Google now does for free.

**However:** gws removed its MCP server in v0.13.0 and has no multi-account concept. These are our two strongest differentiators.

## What We're Good At

1. **Progressive context disclosure** — surfacing the right tools at the right time instead of dumping 200+ tools on an agent
2. **Multi-account orchestration** — account registry, per-account token lifecycle, automatic renewal
3. **Context-efficient responses** — shaping API responses for AI consumption (attachment caching, response trimming)
4. **MCP protocol serving** — we are the bridge between agents and Google Workspace

## What gws Is Good At

1. **API coverage** — every Workspace API, auto-discovered, never stale
2. **Helper commands** — `+send`, `+reply`, `+triage`, `+upload`, `+agenda` with sensible defaults
3. **Structured output** — JSON/table/yaml/csv, consistent across all services
4. **Auto-pagination** — `--page-all` with rate limiting built in
5. **Credential encryption** — AES-256-GCM with OS keyring integration
6. **Safety** — `--dry-run`, `--sanitize` (Model Armor), path traversal validation

## Proposed Architecture

```
┌──────────────────────────────────────────────────┐
│  google-workspace-mcp (our project, rewritten)   │
│                                                  │
│  MCP Protocol Layer                              │
│  ├── Tool registry (semantic, not exhaustive)    │
│  ├── Progressive disclosure engine               │
│  │   └── Surface 5-10 tools based on intent,     │
│  │       not 200+ tools all at once              │
│  ├── Response shaping for AI context efficiency  │
│  └── MCP stdio/SSE transport                     │
│                                                  │
│  Account Orchestration Layer                     │
│  ├── Multi-account registry                      │
│  ├── Per-call credential routing                 │
│  │   └── Sets GOOGLE_WORKSPACE_CLI_CREDENTIALS   │
│  │       _FILE per gws invocation                │
│  ├── Token lifecycle management                  │
│  └── Auth flow (callback server for OAuth)       │
│                                                  │
│  gws Execution Layer                             │
│  ├── Subprocess calls to gws binary              │
│  ├── JSON output parsing                         │
│  ├── Error code mapping (gws exit codes → MCP)   │
│  └── Pagination orchestration                    │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  @googleworkspace/cli (gws)                      │
│  npm dependency — Rust binary, used as engine    │
│  ├── Discovery-based API surface                 │
│  ├── Helper commands (+send, +triage, etc)       │
│  ├── Auto-pagination, structured output          │
│  └── Credential encryption                       │
└──────────────────────────────────────────────────┘
```

## What We Delete

- `src/modules/calendar/service.ts` — gws handles calendar API calls
- `src/modules/drive/service.ts` — gws handles drive API calls
- `src/modules/gmail/services/*` — gws handles gmail API calls
- `src/modules/contacts/service.ts` — gws handles people API calls
- All Google API type definitions mirroring upstream schemas
- Manual pagination logic (gws `--page-all`)
- Most of `src/tools/definitions.ts` — tool schemas derived from gws capabilities

## What We Keep

- **Account manager** (`src/modules/accounts/`) — multi-account registry, token management
- **OAuth callback server** (`src/modules/accounts/callback-server.ts`) — automatic auth flow
- **MCP server shell** (`src/tools/server.ts`) — protocol layer, tool dispatch
- **Attachment optimization** (`src/modules/attachments/`) — context-efficient response shaping

## What We Build New

- **gws executor** — subprocess wrapper that invokes gws with proper credentials, parses JSON output, maps exit codes
- **Semantic tool router** — instead of 1:1 mapping of API methods to MCP tools, group by intent (e.g., "find information", "send message", "manage files")
- **Context disclosure engine** — dynamically adjusts available tools based on conversation state and account capabilities
- **Credential bridge** — translates our account registry into gws-compatible credential file routing

## Key Design Questions

### 1. Subprocess vs library binding?
**Leaning subprocess.** gws is a Rust binary distributed via npm. Calling it as a subprocess with `--format json` gives us clean structured output. No FFI complexity, easy to version-pin, and gws's exit codes (0-5) map cleanly to error handling.

### 2. How do we handle multi-account with gws?
gws uses `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` to select credentials. We maintain our account registry and set this env var per invocation. Our OAuth callback server handles initial auth; we write credentials in gws-compatible format.

### 3. What's the tool surface look like?
Instead of mirroring every API method, we define semantic tools:

| Tool | Maps to gws | Purpose |
|------|-------------|---------|
| `search_emails` | `gws gmail users messages list` | Find emails |
| `send_email` | `gws gmail +send` | Compose and send |
| `reply_to_email` | `gws gmail +reply` | Thread reply |
| `get_calendar` | `gws calendar +agenda` | Today's schedule |
| `create_event` | `gws calendar +insert` | Schedule meeting |
| `find_files` | `gws drive files list` | Search Drive |
| `upload_file` | `gws drive +upload` | Upload to Drive |
| `read_document` | `gws docs documents get` | Read a Doc |
| ... | ... | ... |

Progressive disclosure means an agent sees `list_accounts` first, then account-relevant tools expand based on what services are available.

### 4. Do we keep our own credential storage or adopt gws's?
**Hybrid.** Our account registry (accounts.json) stays — it tracks which accounts exist and their metadata. But actual OAuth tokens could be stored in gws's encrypted format rather than our plaintext JSON files. This is a security improvement for free.

### 5. What about gws skills?
gws ships 92 skills as SKILL.md files for agent consumption. We could expose these as MCP resources — agents can read the skill docs to understand what's possible before invoking tools. This aligns with progressive disclosure.

## Risks

- **gws stability** — v0.13.1, pre-1.0, API could change. Mitigated by version-pinning in package.json.
- **Subprocess overhead** — each tool call spawns a process. Likely negligible for Workspace API latency, but worth benchmarking.
- **Credential format compatibility** — our OAuth tokens may need translation to gws format. Need to verify.
- **"Not officially supported"** — Google's disclaimer. But it's active, has multiple contributors, and the Google DevRel team maintains it.

## What This Buys Us

1. **Coverage expansion overnight** — Sheets, Docs, Slides, Chat, Meet, Admin, Classroom, Forms, Keep, Tasks — all accessible without writing a single API wrapper
2. **Zero API maintenance** — Discovery Service means gws auto-updates when Google changes things
3. **Smaller codebase** — delete ~60% of current TypeScript, replace with thin executor layer
4. **Security improvement** — gws's encrypted credential storage vs our plaintext tokens
5. **Focus on our differentiator** — progressive context disclosure and multi-account orchestration, not API plumbing

## Next Steps

1. Validate credential format compatibility between our OAuth flow and gws
2. Prototype the gws executor — subprocess call, JSON parse, error mapping
3. Test multi-account credential routing via env var
4. Design the semantic tool registry
5. If all checks out, write the ADR and start the rewrite
