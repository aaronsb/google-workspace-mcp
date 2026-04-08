---
status: Draft
date: 2026-04-08
deciders:
  - aaronsb
related:
  - ADR-300
---

# ADR-100: Build-Time Coverage Analysis of gws CLI Surface

## Context

The MCP server exposes a curated subset of the `gws` CLI's capabilities through the factory system (ADR-300). The curated manifest (`src/factory/manifest.yaml`) declares which operations, parameters, and defaults are surfaced to agents. The `gws` CLI itself has a much larger surface — services, resources, methods, helpers, and parameters that the manifest may or may not cover.

Today, the gap between "what gws can do" and "what we expose" is invisible:

- **New gws releases add operations** that we don't know about until someone files an issue.
- **Parameter additions** to existing operations go unnoticed — a gws update might add `supportsAllDrives` to every Drive method, and we'd only discover it when a user hits a limitation.
- **Helper additions** (the `+shortcut` commands) are easy to miss since they don't follow the resource.method pattern.
- **Schema changes** (new enums, changed types, deprecated fields) can silently drift from our manifest definitions.

There's an existing `make manifest-discover` script (`scripts/gen-manifest.sh`) that crawls `gws --help` and emits a YAML file, and `make manifest-diff` runs a textual diff against the curated manifest. This is useful but limited:

- It's a bash script doing text scraping of `--help` output — fragile and imprecise
- The diff is unstructured — a wall of YAML diff with no categorization
- It doesn't use the factory's own manifest parser, so the comparison isn't type-aware
- There's no coverage metric — no way to say "we cover 62 of 147 operations"
- It doesn't run in CI — drift is only caught when someone remembers to run it

### The factory system already has the machinery

The factory's manifest parser (`src/factory/generator.ts`) already understands the manifest schema: services, operations, types, params, defaults, helpers, resources. The `gws` CLI has a `schema` subcommand that emits JSON schemas for each resource method. These two structured representations can be compared programmatically — not as text diffs, but as typed coverage analysis.

## Decision

### Build a coverage analysis tool that reuses the factory's manifest parser

Create a build-time analysis tool (`scripts/coverage-analysis.ts` or similar) that:

1. **Parses the curated manifest** using the same YAML+type system the factory uses
2. **Discovers the gws CLI surface** via `gws schema` (structured JSON, not `--help` scraping)
3. **Produces a structured coverage report** comparing the two

The tool runs as a make target (`make coverage`) and optionally in CI.

### Coverage report structure

The report answers three questions:

**What do we cover?**
```
Coverage: 62/147 operations (42%)

  gmail:      12/23 operations  (52%)
  calendar:    8/14 operations  (57%)
  drive:      11/19 operations  (58%)
  sheets:      5/12 operations  (42%)
  ...
```

**What's new in gws that we don't cover?**
```
New since last baseline:
  + drive.files.generateIds (action) — Generate file IDs for upload
  + sheets.spreadsheets.getByDataFilter (detail) — Get filtered spreadsheet data
  + chat.spaces.messages.create (action) — Send a Chat message
```

**Where do our covered operations have parameter gaps?**
```
Parameter gaps in covered operations:
  drive.files.list:
    + includeLabels (string) — Comma-separated label IDs to include
    - pageSize: manifest max=50, schema max=1000
  calendar.events.list:
    + sharedExtendedProperty (string) — Filter by shared extended property
```

### Baseline tracking

The tool maintains a **baseline file** (`coverage-baseline.json`) that records the last known gws surface. This enables:

- **New operation detection**: "gws 0.22.5 added 3 operations since baseline"
- **Intentional exclusion tracking**: Operations we've reviewed and decided not to surface get marked as `excluded` with a reason, so they don't show up as gaps on every run
- **Regression detection**: If a covered operation disappears from gws, that's a breaking change we need to know about

```json
{
  "gwsVersion": "0.22.5",
  "generatedAt": "2026-04-08T...",
  "services": {
    "drive": {
      "operations": {
        "files.list": { "status": "covered", "params": { "q": "covered", "includeLabels": "gap" } },
        "files.generateIds": { "status": "excluded", "reason": "No agent use case for pre-generating IDs" },
        "files.emptyTrash": { "status": "gap" }
      }
    }
  }
}
```

### Integration points

| Surface | Behavior |
|---------|----------|
| `make coverage` | Run analysis, print report to stdout |
| `make coverage-update` | Run analysis, update baseline file |
| `make check` | Optionally include coverage as a non-blocking check (warn on drift, don't fail) |
| CI | Run on gws dependency updates to flag new operations |
| `make manifest-discover` | Kept for backward compat, but coverage subsumes it |

### Implementation approach

The tool should be TypeScript (not bash) so it can:
- Import and reuse the factory's manifest types and parser
- Use `gws schema <resource.method>` for structured JSON instead of `--help` scraping
- Produce typed output (JSON report + formatted terminal output)
- Be tested like the rest of the codebase

Discovery via `gws schema` is more reliable than `--help` parsing:
- `gws schema` returns the Google API discovery document schema for each method
- It includes parameter types, enums, descriptions, required fields — everything needed for comparison
- `gws --help` is human-readable text that changes format between versions

### Service discovery

To enumerate what gws supports, the tool needs to discover services and their resources/methods. The approach:

1. `gws --help` → list of services (stable, top-level)
2. For each service: `gws <service> --help` → list of resources and helpers
3. For each resource: recursive `--help` to find sub-resources and methods
4. For each method: `gws schema <resource.method>` → full parameter schema

Steps 1-3 use `--help` (no alternative), but step 4 uses structured JSON. The existing `gen-manifest.sh` already does 1-3; the coverage tool can reuse or reimplement that discovery.

## Consequences

### Positive

- **Visibility into coverage gaps**: Know exactly what we expose vs what's available, quantified
- **New capability detection**: gws updates surface new operations automatically
- **Parameter completeness**: Catch cases like the Shared Drive params that were missing for months
- **Intentional exclusion tracking**: Reviewed-and-rejected operations don't create noise on every run
- **Reuses factory types**: Analysis is type-aware, not text-aware — catches semantic drift, not just textual differences
- **CI-friendly**: Can run automatically on dependency updates

### Negative

- **gws CLI is a runtime dependency for analysis**: The tool needs to invoke `gws schema`, so it can't run in environments without the binary
- **Discovery is slow**: Enumerating all services/resources/methods requires many CLI invocations. Should cache or run infrequently
- **Baseline maintenance**: Someone needs to review new operations and mark them as `gap` or `excluded`

### Neutral

- The existing `make manifest-discover` and `make manifest-diff` targets continue to work
- Coverage analysis is advisory — it doesn't change what the server exposes
- The baseline file is committed to the repo, providing a historical record of coverage decisions

## Alternatives Considered

### Keep using the bash manifest-discover script

It works for rough comparisons but produces unstructured diffs that are hard to act on. No coverage metrics, no baseline tracking, no parameter-level analysis. The existing script is a proof of concept; the coverage tool is the production version.

### Scrape the Google API discovery documents directly

Instead of going through `gws`, fetch the discovery documents from `https://www.googleapis.com/discovery/v1/apis/...` directly. This would be more authoritative but introduces complexity: we'd need to map between Google API resource paths and gws CLI resource paths, handle API versions, and deal with APIs that gws wraps with helpers. Going through `gws schema` keeps the comparison in the same abstraction layer.

### Make coverage analysis block CI

Fail the build if coverage drops or new gaps appear. Too aggressive — adding new gws operations shouldn't break our CI. Coverage drift is informational, not actionable until someone decides to add the operation.
