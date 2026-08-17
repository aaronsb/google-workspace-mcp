/**
 * Offline drift gate for coverage-baseline.json.
 *
 * `make coverage` reads Google's Discovery service over the network, so it cannot join
 * `make check` — which has to stay offline and fast, because CI runs it on every push.
 * Nothing else looked at the baseline, and it rotted for a month without a single failure:
 * last written 2026-07-12, so it predated both the Meet space work and the whole contacts
 * service, AND it still used a top-level key the code had renamed (`gwsVersion`, written
 * as `apiSurface` since). Stale in shape as well as content, and silent.
 *
 * Everything below compares the baseline against artifacts already committed —
 * descriptor.json and the manifests — so it needs no network. A baseline that disagrees
 * with the descriptor is drift by definition; noticing that never required asking Google.
 *
 * When one of these fails the fix is `make coverage-update`, then read the diff.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadManifest } from '../../factory/generator.js';
import { loadDescriptor } from '../../google/descriptor.js';

const baseline = JSON.parse(
  readFileSync(new URL('../../../coverage-baseline.json', import.meta.url), 'utf-8'),
) as {
  apiSurface?: string;
  generatedAt?: string;
  services?: Record<string, { operations: Record<string, { status: string }> }>;
};

describe('coverage baseline', () => {
  it('has the keys the writer actually writes', () => {
    // The failure this exists for: analyze.js renamed `gwsVersion` to `apiSurface` and the
    // committed file kept the old key. Every consumer read undefined and nothing objected.
    expect(Object.keys(baseline).sort()).toEqual(['apiSurface', 'generatedAt', 'services']);
    expect(typeof baseline.apiSurface).toBe('string');
    expect(typeof baseline.generatedAt).toBe('string');
  });

  it('covers exactly the services the descriptor knows about', async () => {
    // Catches a whole service missing, which is how `people` went unrecorded: contacts
    // shipped, the headline percentage was computed without it, and it read as fine.
    const descriptor = await loadDescriptor();
    expect(Object.keys(baseline.services ?? {}).sort())
      .toEqual(Object.keys(descriptor.services).sort());
  });

  it('lists exactly the operations Google declares, per service', async () => {
    const descriptor = await loadDescriptor();
    const drift: string[] = [];

    for (const [service, svc] of Object.entries(descriptor.services)) {
      const recorded = Object.keys(baseline.services?.[service]?.operations ?? {}).sort();
      const declared = Object.keys(svc.methods).sort();
      if (recorded.join() === declared.join()) continue;

      const missing = declared.filter((m) => !recorded.includes(m));
      const extra = recorded.filter((m) => !declared.includes(m));
      drift.push(
        `${service}: ${missing.length} not in the baseline${missing.length ? ` (${missing.slice(0, 3).join(', ')}…)` : ''}, ` +
        `${extra.length} no longer declared by Google${extra.length ? ` (${extra.slice(0, 3).join(', ')}…)` : ''}`,
      );
    }

    expect(drift, 'run `make coverage-update` and review the diff').toEqual([]);
  });

  it('marks an operation covered when, and only when, a manifest declares it', () => {
    // The claim the baseline exists to make. Adding an operation to a manifest without
    // regenerating leaves it recorded as a gap — the file then understates the tool and
    // offers work that is already done.
    const declared = new Set<string>();
    for (const service of Object.values(loadManifest().services)) {
      for (const op of Object.values(service.operations)) {
        if (op.resource) declared.add(`${service.google_service}.${op.resource}`);
      }
    }

    const wrong: string[] = [];
    for (const [service, svc] of Object.entries(baseline.services ?? {})) {
      for (const [path, op] of Object.entries(svc.operations)) {
        const isDeclared = declared.has(`${service}.${path}`);
        const saysCovered = op.status === 'covered';
        if (isDeclared !== saysCovered) {
          wrong.push(
            `${service}.${path}: baseline says ${op.status}, ` +
            `manifest ${isDeclared ? 'declares it' : 'does not declare it'}`,
          );
        }
      }
    }

    expect(wrong, 'run `make coverage-update` and review the diff').toEqual([]);
  });
});
