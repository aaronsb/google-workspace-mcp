---
description: Service factory manifest expansion, patch development, operation coverage
vocabulary: manifest operation patch formatter service factory coverage gws yaml generator handler hooks custom hydration schema defaults lint discover curate
pattern: manifest\.yaml|patch\.ts|factory|coverage
files: src/factory/|src/services/
---
# Service Factory Development

The MCP server uses a three-layer factory architecture (ADR-300). Understanding the layers matters for expanding coverage.

## Architecture

```
manifest.yaml → generator.ts → MCP tool schemas + handlers
                    ↑
              patches (optional per-service hooks)
```

- **Manifest** (`src/factory/manifest.yaml`) — declares services, operations, params, defaults
- **Generator** (`src/factory/generator.ts`) — reads manifest, produces schemas + handlers
- **Patches** (`src/services/{service}/patch.ts`) — domain-specific hooks for formatting, hydration, custom logic
- **Registry** (`src/factory/registry.ts`) — shared singleton, imported by handler.ts and tools.ts

## Adding a New Operation (YAML only)

Most operations need only a manifest entry. Add under the service's `operations:` block:

```yaml
operationName:
  type: list | detail | action
  description: "what it does"
  resource: resource.method       # for API calls
  # OR
  helper: "+helperName"           # for gws helpers
  params:
    paramName:
      type: string | number | boolean
      description: "what this param is"
      required: true              # optional
      maps_to: apiParamName       # optional, if API name differs
      default: value              # optional
  defaults:                       # merged into --params JSON
    fixedParam: value
  cli_args:                       # for helpers: param → flag mapping
    paramName: "--flag-name"
```

Run `make manifest-lint` to validate, then `npm test` to verify.

## Adding a Patch Formatter

When default formatting isn't enough, add a case to the service patch's format hook:

```typescript
// src/services/{service}/patch.ts
formatList: (data: unknown, ctx: PatchContext) => {
  switch (ctx.operation) {
    case 'newOperation':
      return formatNewThing(data);  // your formatter
    default:
      return formatExistingThing(data);
  }
},
```

## When You Need a Custom Handler

Use `customHandlers` when the operation doesn't fit the generic pattern:
- Needs both `--params` AND `--json` (e.g. `modify` with request body)
- Multi-step logic (e.g. search hydration)
- Non-standard CLI args (positional args, special flags)

```typescript
customHandlers: {
  operationName: async (params, account) => {
    // Full control — build args, call execute, format response
    return { text: '...', refs: { ... } };
  },
},
```

## Make Targets

| Command | Purpose |
|---------|---------|
| `make manifest-lint` | Validate manifest structure, count operations |
| `make manifest-discover` | Walk gws CLI, emit all 287+ discovered operations |
| `make manifest-diff` | Diff discovered vs curated manifest |
| `make test` | Run unit tests (includes factory + patch coverage) |
| `make build` | Compile + copy manifest to build/ |

## Patch Coverage

The `patch-coverage.test.ts` test reports which operations have custom formatting vs defaults. Run `npm test -- --testPathPattern patch-coverage --verbose` to see the breakdown. When adding operations, check if they need custom formatting — action types usually don't, list/detail types often do.

## Discovery Workflow

```bash
make manifest-discover          # generates discovered-manifest.yaml
# Find the operation you want in discovered-manifest.yaml
# Copy the entry to src/factory/manifest.yaml
# Curate: improve description, add defaults, add param mappings
make manifest-lint               # validate
npm test                         # verify
# Optionally add a patch formatter if defaults aren't good enough
```
