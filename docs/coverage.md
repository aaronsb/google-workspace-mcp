# API Coverage

This server exposes a **curated subset** of Google's API surface — the operations and parameters actually useful to an AI agent, with LLM-friendly descriptions, sensible defaults, and patched response formatting. It is not a 1:1 passthrough of every Google method.

Coverage is *measured*, not estimated. The mapper reads Google's [Discovery documents](https://developers.google.com/discovery) — the same machine-readable specifications the client is generated from — and diffs them against the curated manifest. The denominator is Google's, so the frontier is real.

Adding an operation is a config change, not a code change: drop an entry into `src/factory/manifest/<service>.yaml` and it becomes a fully-formed MCP tool operation. See [ADR-103](architecture/core/ADR-103-generate-a-google-api-descriptor-retire-the-gws-facade.md) (the generated descriptor) and [ADR-300](architecture/api/ADR-300-service-tool-factory-with-manifest-driven-generation.md) (the manifest-driven factory).

## Snapshot

> Generated `2026-07-12` against Google Discovery (calendar/v3, docs/v1, drive/v3, gmail/v1, meet/v2, sheets/v4, tasks/v1). Regenerate with `make coverage`; this table drifts as Google adds methods or the manifest grows.

**60 / 233 methods covered (26%)** across the seven Google APIs this server targets.

| Service | Covered | % | Gaps | MCP tool |
|---|---:|---:|---:|---|
| docs | 3 / 3 | 100% | — | `manage_docs` |
| tasks | 9 / 14 | 64% | 5 | `manage_tasks` |
| meet | 10 / 18 | 56% | 8 | `manage_meet` |
| sheets | 8 / 17 | 47% | 9 | `manage_sheets` |
| drive | 14 / 64 | 22% | 50 | `manage_drive` |
| calendar | 7 / 38 | 18% | 31 | `manage_calendar` |
| gmail | 9 / 79 | 11% | 70 | `manage_email` |

Those 60 Google methods back 80 MCP operations — a few operations compose more than one method (Gmail search hydrates each hit with `messages.get`; the agenda merges across calendars), and a few methods back more than one operation.

Low percentages on the high-surface services are by design. Most uncovered Gmail and Drive methods are admin/domain operations, label and permission plumbing variants, or filtering parameters an agent rarely needs. The covered slice is the "do useful work in a conversation" set. `make coverage` prints the full per-operation parameter-gap list for anyone curating an addition.

### Note on the numbers

Earlier revisions of this page reported **72 / 344 (21%)**. That is not comparable to the figure above, and the difference is not progress — it is a different measurement.

The denominator is Google's own published surface for the seven APIs we target, read from the Discovery documents. It is never derived from help text or any other human-readable prose: a regex over descriptions once captured `calendars.The` — a word from a wrapped line — and recorded it in the baseline as a real uncovered method, offered to contributors as work. A denominator that also counts services we do not expose, or operations Google does not have, is measuring the wrong thing. See ADR-103, verification item 11.

## Regenerating

| Command | What it does |
|---|---|
| `npm run generate-descriptor` | Re-reads Google's Discovery documents and regenerates `src/google/descriptor.json`. A CI drift gate runs this with `--check` and fails if the committed artifact is stale. |
| `make coverage` | Reads Google's live surface, diffs it against the curated manifest, and prints the coverage table plus every uncovered operation and every parameter gap in covered operations. |
| `make coverage-update` | Same, but writes the result to `coverage-baseline.json` so the next run can show "new since baseline". |
| `make manifest-lint` | Validates the curated manifest. |

To add an operation, find it in the coverage report's gap list, add an entry to the right `src/factory/manifest/<service>.yaml`, and curate the description, defaults, and parameter mappings. The descriptor already knows its path, HTTP verb, parameters, and scopes — nothing is transcribed by hand. Then `make manifest-lint && make check`.

An operation naming a method Google does not publish is a **compile error**: method names are generated into a TypeScript union from the descriptor.

## Excluding an operation

Not every gap should be closed. Mark a deliberate non-goal as `"status": "excluded"` with a `reason` in `coverage-baseline.json`; regeneration preserves it rather than re-offering it as work.
