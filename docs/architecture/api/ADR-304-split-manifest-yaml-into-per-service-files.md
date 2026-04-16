---
status: Draft
date: 2026-04-15
deciders:
  - aaronsb
related:
  - ADR-300
---

# ADR-304: Split manifest.yaml into per-service files

## Context

`src/factory/manifest.yaml` is now 1383 lines and covers seven services. The quality-check hook has flagged it twice in the last two PRs (sheets fix, sheets expansion) with the 800-line priority threshold. Each new service adds another 100–300 lines; the growth is mechanical, not problematic per service, but the aggregate is.

The per-service breakdown today:

```
  gmail:    lines 11–278  (268 lines)
  calendar: lines 279–478 (200 lines)
  drive:    lines 479–767 (289 lines)
  sheets:   lines 768–994 (227 lines)
  docs:     lines 995–1077 (83 lines)
  tasks:    lines 1078–1220 (143 lines)
  meet:     lines 1221–1383 (163 lines)
```

Each service's block is self-contained. Cross-service references do not exist — every operation's params, resource, helper, and defaults live entirely within its service block. The file is a concatenation of independent sections that happen to share a YAML root.

Editing one service means scrolling past all the others. A merge conflict in gmail's operations routinely touches the same file as an unrelated sheets change. `git blame` on a single service's operation loses context quickly because line numbers shift when neighbors grow. The coverage linter's output and the `manifest-lint` Makefile target both operate on the whole file; neither benefits from the bundling.

The other side of the codebase — service-specific handler logic — is already split per service: `src/services/gmail/patch.ts`, `src/services/calendar/patch.ts`, etc. The manifest is the last single-file concession to historical organization, from when the factory was strictly manifest-driven with no patches.

## Decision

Replace the single `src/factory/manifest.yaml` with a directory of per-service files at `src/factory/manifest/`:

```
src/factory/manifest/
  gmail.yaml
  calendar.yaml
  drive.yaml
  sheets.yaml
  docs.yaml
  tasks.yaml
  meet.yaml
```

Each file contains just that service's definition as the YAML root — no enclosing `services:` key. The filename (minus `.yaml`) is the service key:

```yaml
# src/factory/manifest/sheets.yaml
tool_name: manage_sheets
description: "Read, write, and manage Google Sheets spreadsheets."
requires_email: true
gws_service: sheets
operations:
  get:
    type: detail
    ...
```

`loadManifest()` enumerates the directory, parses each file, and assembles a `Manifest` with the same shape it returns today:

```ts
// pseudo-code
const files = readdirSync(manifestDir).filter(f => f.endsWith('.yaml'));
const services: Record<string, ServiceDef> = {};
for (const file of files) {
  const name = basename(file, '.yaml');
  services[name] = parseYaml(readFileSync(resolve(manifestDir, file), 'utf-8'));
}
return { services };
```

The loader's search strategy (module-relative → cwd fallback, for Jest + mcpb compatibility) gets reused — just pointing at the directory instead of the file.

### Migration

1. Create `src/factory/manifest/` with one file per service, content taken verbatim from the current sections.
2. Update `src/factory/generator.ts` `loadManifest()` to enumerate the directory.
3. Update `Makefile`:
   - `build:` copies `src/factory/manifest/` recursively to `build/factory/manifest/` instead of the single file.
   - `manifest-lint:` walks the directory (trivial adapt).
   - `mcpb:` ships the directory in the bundle.
4. Update `scripts/gen-manifest.sh` references if any (used only for discovery output, not the runtime manifest).
5. Delete `src/factory/manifest.yaml`.

The split is mechanical — cut each service's YAML section into its own file, adjust indentation to bring the service's body up one level (strip the leading two-space indent from the children of `  gmail:`, etc.).

## Consequences

### Positive

- No file above ~300 lines. The quality-check hook's recurring flag on this file goes away.
- Adding a service is now one new file, not an edit to a growing shared file. Zero merge contention between services.
- `git blame` on a service's operations stays stable over time — line numbers don't drift because of unrelated neighbors.
- Editing context is focused. You open the file for the service you're changing, and only that service's content is on screen.
- Symmetrical with the patch organization already in `src/services/*/patch.ts` — both layers are now per-service.

### Negative

- One-time migration touches every service block. Large diff, but mechanical; `git log --follow` preserves history per file after the split.
- `loadManifest()` now does filesystem enumeration instead of a single `readFileSync`. Negligible cost at startup (a handful of small files) but worth noting.
- Bundling for mcpb is now a directory copy instead of a file copy. One-line Makefile change.
- A service with a malformed YAML file now loads *everyone else* successfully while dropping the malformed one. Decision: fail hard on any malformed file to preserve current whole-or-nothing behavior.

### Neutral

- The `Manifest` type and `generateTools()` API stay identical. Only `loadManifest()` changes.
- The `manifest-discover` / `manifest-diff` tooling (which produces a single `discovered-manifest.yaml`) is unaffected; it was always independent of the curated manifest's file layout.
- ADR-303 (auto-append next-steps) is orthogonal to this split and can land before or after.

## Alternatives Considered

**Co-locate manifest files with service patches under `src/services/<name>/manifest.yaml`.** More cohesive — everything for a service lives in one directory. Rejected for this ADR because it's a larger migration (the build pipeline's tsc output tree would need to include non-TS assets from `src/services/`, and the loader would need to know about both locations during the transition). Worth a follow-up if it becomes compelling; the primary goal here is breaking up the single file, which `src/factory/manifest/` accomplishes with minimal surface area change.

**Keep `manifest.yaml`, introduce YAML anchors or `$include` references.** Some YAML parsers support file includes via custom tags. Rejected: our parser (`src/factory/yaml.ts`) is a simple subset that doesn't support includes, and adding that capability means maintaining it. The filesystem already does "include" semantics for free.

**Split by domain instead of service** (e.g., `communication.yaml` for gmail+meet+chat, `storage.yaml` for drive+docs+sheets+tasks). Rejected: domains are fuzzier than services, adding judgment calls about which bucket a new service goes in. Service-per-file is the natural grain of the existing structure.

**Leave it as one file and raise the quality-check threshold for YAML.** The hook's 800-line rule targets code files where cognitive load scales with length. YAML data files are arguably different. Rejected: the file-size pain is real (scrolling, merge conflicts, noisy blame) independent of what the linter says. Splitting solves the underlying ergonomics problem, not just the linter complaint.
