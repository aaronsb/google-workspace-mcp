/**
 * Parameter coverage for a method that several operations call.
 *
 * search, triage and previewModifyMatching all call users.messages.list. Keeping only the
 * last operation's parameters reported the others' as gaps: adding previewModifyMatching,
 * which maps `q` but not `pageToken`, turned `pageToken` into a gap that search covers.
 */
import { describe, expect, it } from 'vitest';

import { compareSurfaces } from '../../coverage/compare.js';
import type { Manifest } from '../../factory/types.js';
import type { DiscoveredSurface } from '../../coverage/types.js';

const param = { type: 'string', description: '', required: false };

const discovered: DiscoveredSurface = {
  apiSurface: 'test',
  services: {
    gmail: {
      helpers: {},
      operations: {
        'users.messages.list': {
          resourcePath: 'users.messages.list', description: '', httpMethod: 'GET',
          params: { q: param, pageToken: param, labelIds: param },
        },
      },
    },
  },
};

const manifest = {
  services: {
    gmail: {
      tool_name: 'manage_email', description: '', requires_email: true, google_service: 'gmail',
      operations: {
        search: {
          type: 'list', description: '', resource: 'users.messages.list',
          params: { query: { type: 'string', description: '', maps_to: 'q' }, pageToken: { type: 'string', description: '' } },
        },
        previewModifyMatching: {
          type: 'list', description: '', resource: 'users.messages.list',
          params: { query: { type: 'string', description: '', maps_to: 'q' } },
        },
      },
    },
  },
} as unknown as Manifest;

describe('a method several operations call', () => {
  it('counts a parameter covered when any of them maps it', () => {
    const gmail = compareSurfaces(manifest, discovered).services.find((s) => s.service === 'gmail')!;
    const gaps = gmail.paramGaps['users.messages.list'].map((g) => g.paramName);
    expect(gaps).toEqual(['labelIds']);
  });
});
