/**
 * getThread shows who received each message, not only who wrote it.
 *
 * users.threads.get with format:metadata returns ONLY the headers named in
 * metadataHeaders. So the formatter reading Cc is not enough: if the manifest stops
 * asking for it, Gmail never sends it, the line is omitted as absent, and the thread
 * reads as though nobody was copied. These tests feed in a payload containing Cc and
 * cannot notice that; repeated-params.test.ts asserts the headers actually requested.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../google/client.js');

import { gmailPatch } from '../../../services/gmail/patch.js';
import type { PatchContext } from '../../../factory/types.js';

const ctx = { operation: 'getThread', params: {}, account: 'me@test.com' } as PatchContext;

function message(id: string, headers: Array<{ name: string; value: string }>): Record<string, unknown> {
  return { id, snippet: `Body of ${id}`, payload: { headers } };
}

function thread(...messages: Array<Record<string, unknown>>): Record<string, unknown> {
  return { id: 't-1', messages };
}

describe('getThread recipients', () => {
  it('shows every recipient header a message has', () => {
    const { text } = gmailPatch.formatDetail!(thread(message('m-1', [
      { name: 'From', value: 'alice@test.com' },
      { name: 'To', value: 'bob@test.com' },
      { name: 'CC', value: 'carol@test.com' },
      { name: 'bcc', value: 'dave@test.com' },
      { name: 'Reply-To', value: 'list@test.com' },
    ])), ctx);
    expect(text).toContain('To: bob@test.com');
    expect(text).toContain('Cc: carol@test.com');
    expect(text).toContain('Bcc: dave@test.com');
    expect(text).toContain('Reply-To: list@test.com');
  });

  it('omits recipient headers a message does not have', () => {
    const { text } = gmailPatch.formatDetail!(thread(message('m-1', [
      { name: 'From', value: 'alice@test.com' },
    ])), ctx);
    expect(text).not.toMatch(/^(To|Cc|Bcc|Reply-To):/m);
  });

  it('keeps each message\'s recipients with that message', () => {
    const { text } = gmailPatch.formatDetail!(thread(
      message('m-1', [
        { name: 'From', value: 'alice@test.com' },
        { name: 'To', value: 'bob@test.com' },
        { name: 'Cc', value: 'carol@test.com' },
      ]),
      message('m-2', [
        { name: 'From', value: 'bob@test.com' },
        { name: 'To', value: 'alice@test.com' },
      ]),
    ), ctx);

    const first = text.slice(text.indexOf('**alice@test.com**'), text.indexOf('**bob@test.com**'));
    const second = text.slice(text.indexOf('**bob@test.com**'));
    expect(first).toContain('To: bob@test.com');
    expect(first).toContain('Cc: carol@test.com');
    expect(first).toContain('Body of m-1');
    expect(second).toContain('To: alice@test.com');
    expect(second).toContain('Body of m-2');
    expect(second).not.toContain('Cc:');
  });
});
