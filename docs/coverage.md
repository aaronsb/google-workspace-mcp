# API Coverage

This server exposes a **curated subset** of the [`gws` CLI](https://github.com/googleworkspace/cli)'s surface — the operations and parameters that are actually useful to an AI agent, with LLM-friendly descriptions, sensible defaults, and patched response formatting. It is not a 1:1 passthrough of every Google API method. See [ADR-100](architecture/core/ADR-100-build-time-coverage-analysis-of-gws-cli-surface.md) (build-time coverage analysis) and [ADR-300](architecture/api/ADR-300-service-tool-factory-with-manifest-driven-generation.md) (the manifest-driven factory).

Adding an operation is a config change, not a code change: drop an entry into `src/factory/manifest/<service>.yaml` and it becomes a fully-formed MCP tool operation. So coverage grows on demand, in the direction agents actually need.

## Snapshot

> Generated `2026-05-11` against `gws 0.22.5`. Regenerate with `make coverage`; this table will drift as gws adds methods or the manifest grows.

**72 / 344 operations covered (21%)** across 12 gws services. The MCP tools surface 7 of them (`manage_email`, `manage_calendar`, `manage_drive`, `manage_sheets`, `manage_docs`, `manage_tasks`, `manage_meet`); the rest aren't exposed yet.

| Service | Covered | % | Gaps | MCP tool |
|---|---:|---:|---:|---|
| docs | 4 / 4 | 100% | — | `manage_docs` |
| tasks | 9 / 14 | 64% | 5 | `manage_tasks` |
| meet | 10 / 18 | 56% | 8 | `manage_meet` |
| sheets | 9 / 19 | 47% | 10 | `manage_sheets` |
| drive | 15 / 65 | 23% | 50 | `manage_drive` |
| calendar | 9 / 40 | 23% | 31 | `manage_calendar` |
| gmail | 14 / 85 | 16% | 71 | `manage_email` |
| events | 1 / 17 | 6% | 16 | — |
| chat | 1 / 46 | 2% | 45 | — |
| slides | 0 / 5 | 0% | 5 | — |
| people | 0 / 24 | 0% | 24 | — |
| keep | 0 / 7 | 0% | 7 | — |

Low percentages on the high-surface services (gmail, drive) are by design — most of the uncovered methods are admin/domain operations, label/permission plumbing variants, or pagination/filtering parameters that an agent rarely needs. The covered slice is the "do useful work in a conversation" set. `make coverage` prints the full per-operation parameter-gap list for anyone curating an addition.

### Not exposed yet

- **people** (Contacts) — `gws auth login` doesn't offer the `contacts.readonly` scope ([googleworkspace/cli#556](https://github.com/googleworkspace/cli/issues/556)).
- **slides**, **keep**, **chat**, **events** — no concrete agent use case has driven coverage. Open an issue if you have one.

## Regenerating

| Command | What it does |
|---|---|
| `make coverage` | Discovers the live gws CLI surface, diffs it against the curated manifest, prints the coverage table + every uncovered operation + every parameter gap in covered operations. |
| `make coverage-update` | Same, but writes the result to `coverage-baseline.json` so the next run can show "new since baseline." |
| `make manifest-discover` | Dumps the full discovered manifest (all gws operations, with `# CURATE` markers) to `discovered-manifest.yaml` — the raw material for a new manifest entry. |
| `make manifest-diff` | Diffs the curated manifest against `discovered-manifest.yaml`. |

To add an operation: find it in `discovered-manifest.yaml`, copy the entry into the right `src/factory/manifest/<service>.yaml`, curate the description / defaults / param mappings, then `make manifest-lint && make test`. See `.claude/ways/factory/way.md` for the full workflow.
