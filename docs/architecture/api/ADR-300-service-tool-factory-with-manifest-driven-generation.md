---
status: Draft
date: 2026-03-18
deciders:
  - aaronsb
related:
  - ADR-200
---

# ADR-300: Service tool factory with manifest-driven generation

## Context

The MCP server currently has 5 hand-coded tools: manage_accounts, manage_email, manage_calendar, manage_drive, and queue_operations. Each handler is bespoke — custom arg construction, custom formatting, custom next-steps. This worked for bootstrapping, but:

1. **Tool sprawl at the agent framework level.** Most agent frameworks (Claude Code, Cursor, Cline, etc.) present tools as a flat list that users enable/disable individually. Adding sheets, docs, tasks, people, chat (5 more services) means 5 more tools to manage. At 10+ tools, the UX becomes noisy and error-prone for end users.

2. **gws already has dynamic API discovery.** The CLI resolves service/resource/method at runtime from Google's Discovery API. We're hand-maintaining a parallel catalog of what gws can do.

3. **80% of handler code is boilerplate.** Call `execute()` with args, format the result, append next-steps. Only ~20% is service-specific: email hydration, +triage/+agenda helpers, header extraction from payloads.

4. **Google's own direction is subcall/operation-based.** The gws CLI uses `service resource method` — a natural three-level hierarchy. Our operation-based tool pattern (one tool, many operations) already mirrors this. Extending it to a factory is the natural next step.

## Decision

Replace hand-coded per-service handlers with a three-layer architecture:

### Layer 1: Factory (generic service wrapper)

A base handler that, given a manifest entry, generates:
- **Tool schema** — operation enum, typed parameters, descriptions
- **Handler function** — maps operations to gws CLI args, calls executor, applies formatting
- **Default formatting** — generic markdown for list/detail/action responses

The factory produces a functional tool for any gws service with zero custom code.

### Layer 2: Manifest (service registry)

A declarative YAML/JSON file that describes supported services and their operations:

```yaml
services:
  gmail:
    tool_name: manage_email
    description: "Search, read, send, or triage emails"
    requires_email: true
    operations:
      search:
        type: list
        resource: users.messages.list
        params:
          query: { type: string, maps_to: "q", description: "Gmail search query" }
          maxResults: { type: number, default: 10, max: 50 }
        hydration:
          resource: users.messages.get
          format: metadata
          headers: [From, Subject, Date]
      read:
        type: detail
        resource: users.messages.get
        params:
          messageId: { type: string, required: true, maps_to: "id" }
      send:
        type: action
        helper: "+send"
        params:
          to: { type: string, required: true }
          subject: { type: string, required: true }
          body: { type: string, required: true }
      triage:
        type: list
        helper: "+triage"

  calendar:
    tool_name: manage_calendar
    description: "List events, view agenda, or manage calendar events"
    requires_email: true
    operations:
      list:
        type: list
        resource: events.list
        params:
          timeMin: { type: string, default: "$today" }
          maxResults: { type: number, default: 10, max: 50 }
        defaults:
          calendarId: primary
          singleEvents: true
          orderBy: startTime
      agenda:
        type: list
        helper: "+agenda"
      # ... etc

  sheets:
    tool_name: manage_sheets
    description: "Read, write, and manage spreadsheets"
    requires_email: true
    operations:
      get:
        type: detail
        resource: spreadsheets.get
        params:
          spreadsheetId: { type: string, required: true }
      # new service, zero custom handler code needed
```

### Layer 3: Patches (per-service customization)

Type-safe hooks that the factory calls at well-defined points:

| Hook | When | Example |
|------|------|---------|
| `beforeExecute` | After arg construction, before gws call | Add default params, validate combinations |
| `afterExecute` | After gws returns, before formatting | Email search hydration, response reshaping |
| `formatList` | Override default list formatter | Email: pipe-delimited with from/subject |
| `formatDetail` | Override default detail formatter | Email: header extraction from payload |
| `nextSteps` | Override default next-steps | Domain-specific follow-on suggestions |

Patches are optional. A service with no patches gets the factory defaults — functional but generic. Services with patches get hardened, domain-aware behavior.

```typescript
// src/services/gmail/patch.ts
export const gmailPatch: ServicePatch = {
  afterExecute: {
    search: async (result, args, account) => {
      // Hydrate message IDs with metadata
      return hydrateMessages(result, account);
    },
  },
  formatList: (data) => formatEmailList(data),
  formatDetail: (data) => formatEmailDetail(data),
  nextSteps: emailNextSteps,
};
```

### Tool registration

At startup, the factory reads the manifest, applies any patches, and registers tools:

```typescript
for (const [service, config] of Object.entries(manifest.services)) {
  const patch = patches[service]; // optional
  const schema = generateSchema(config);
  const handler = generateHandler(config, patch);
  registerTool(schema, handler);
}
```

### What stays hand-coded

- **manage_accounts** — not a gws service wrapper; manages our own registry
- **queue_operations** — meta-tool that orchestrates other tools
- **Patches** for services that need custom behavior (gmail, calendar, drive initially)

### File structure

```
src/
  factory/
    manifest.yaml          # Service registry
    generator.ts           # Schema + handler generation
    types.ts               # ServiceConfig, ServicePatch, hook types
    defaults.ts            # Default formatting, next-steps
  services/
    gmail/
      patch.ts             # Email-specific hooks
      hydration.ts         # Search result hydration
    calendar/
      patch.ts             # Calendar-specific hooks
    drive/
      patch.ts             # Drive-specific hooks
  server/
    handler.ts             # Loads factory output + accounts + queue
    tools.ts               # Generated at startup, not hand-coded
```

### Packaging as .mcpb

The factory architecture is designed for distribution as a standalone `.mcpb` package (Claude Desktop, other agent marketplaces). Key packaging concerns:

- **Credential storage** — OAuth tokens and client secrets use the MCP `sensitive: true` spec flag. The host framework manages secure storage; we declare what's sensitive, we don't roll our own encrypted store.
- **XDG paths** — Account registry and exported credentials live at well-known user-profile paths (`~/.config/google-workspace-mcp/`, `~/.local/share/google-workspace-mcp/`). The package ships no secrets.
- **gws as bundled dependency** — The gws binary is an npm dependency, resolved from `node_modules/.bin/`. The .mcpb packages it; the user doesn't install gws separately.
- **First-run setup** — `manage_accounts` operation `authenticate` handles the full OAuth browser flow. No CLI prerequisite for end users.
- **Service activation** — The manifest declares all supported services. Agent frameworks can enable/disable tools individually (1:1 tool-to-service). Users choose what Google services to expose.

### Proving it out

Reimplement the existing three services (gmail, calendar, drive) using the factory + patches. Success criteria:

1. Same markdown output as current hand-coded handlers
2. Same test coverage (unit + integration pass without changes)
3. Patches are small — most code lives in the factory
4. Adding a new service (e.g. sheets) requires only a manifest entry and optionally a patch

## Consequences

### Positive

- Adding a new gws service is a manifest entry, not a handler rewrite
- 1:1 tool-to-service ratio keeps agent framework UX clean
- Patches isolate service quirks from generic plumbing
- Manifest is human-readable documentation of what we support
- Aligns with gws's own service/resource/method hierarchy

### Negative

- Indirection: debugging goes through factory → manifest → patch instead of a direct handler
- Manifest schema is a new thing to maintain and validate
- Patches need well-defined hook contracts — too few and they're useless, too many and they're a parallel handler system
- YAML manifest parsing adds a startup dependency

### Neutral

- Existing tests need reworking to test factory output instead of hand-coded handlers
- manage_accounts and queue_operations remain hand-coded (they're not service wrappers)
- The manifest becomes the source of truth for tool schemas, replacing tools.ts

## Alternatives Considered

- **Keep hand-coding per service.** Works at 4 services, doesn't scale to 10+. Rejected because of tool sprawl and boilerplate duplication.

- **Single mega-tool (`manage_workspace`)** with service as a parameter. Rejected because it makes every operation description generic, hurts LLM tool selection, and prevents per-service enable/disable in agent frameworks.

- **Auto-generate everything from gws discovery API at runtime.** Rejected because Google's API schemas don't carry the UX metadata (descriptions, defaults, groupings) that make tools usable by LLM agents. The manifest is the curation layer.

- **Code generation (build-time, not runtime).** Generate handler TypeScript from manifest during build. Considered viable but adds build complexity. Runtime generation is simpler and the manifest is small enough that startup cost is negligible.
