# Plan: Response Quality + Factory

## Completed

- [x] **Workstream 1: Formatting facade** — PR #60, merged
- [x] **Workstream 2: Queue enhancement** — PR #61, merged
- [x] **Workstream 3: Auth lifecycle (ADR-200)** — PR #62, merged
- [x] **Fix: Email search hydration** — PR #63, merged
- [x] **ADR-300 drafted** — Service tool factory with manifest-driven generation

## Next: ADR-300 Implementation (branch: `feature/service-factory`)

Reimplement gmail, calendar, drive through the factory pattern.
Accept ADR-300 when proof-of-concept passes.

### Build order

1. **Types + manifest schema** — `src/factory/types.ts`, define ServiceConfig, ServicePatch, manifest shape
2. **Manifest** — `src/factory/manifest.yaml`, declare gmail/calendar/drive with operations, params, resource paths
3. **Factory generator** — `src/factory/generator.ts`, reads manifest → produces tool schemas + handlers
4. **Default formatting** — `src/factory/defaults.ts`, generic list/detail/action markdown renderers
5. **Patches** — `src/services/gmail/patch.ts`, `calendar/patch.ts`, `drive/patch.ts`, move domain-specific logic
6. **Wire into server** — replace hand-coded tools.ts + handler.ts with factory output
7. **Tests** — existing tests should pass with no assertion changes (same output)
8. **New service smoke test** — add sheets or tasks via manifest-only (no patch) to prove the factory works

### Success criteria

- Same markdown output as current hand-coded handlers
- 204+ tests pass (unit + integration)
- Patches are small — most code in factory
- Adding a new service = manifest entry + optional patch
