/**
 * A REPEATED query parameter is sent once per value, never comma-joined.
 *
 * Gmail's `metadataHeaders` is repeated: `?metadataHeaders=From&metadataHeaders=Subject`.
 * Sent as one comma-joined string, Google looks for the single header literally named
 * "From,Subject,Date,To", finds none, and returns a payload with NO HEADERS AT ALL.
 *
 * It does not error. `manage_email getThread` rendered every message in a thread with an
 * empty sender and an empty subject —
 *
 *     **** —
 *     Add full device config for QC Earbuds…
 *
 * — and reported success. The descriptor already records which parameters are repeated,
 * so the client expands a comma-separated string rather than trusting each caller to
 * remember the difference.
 */
import { describe, expect, it, beforeAll } from 'vitest';

import { buildRequest } from '../../google/client.js';
import { loadDescriptor } from '../../google/descriptor.js';
import type { ApiDescriptor } from '../../google/descriptor.js';

let descriptor: ApiDescriptor;
beforeAll(async () => { descriptor = await loadDescriptor(); });

describe('repeated query parameters', () => {
  it('expands a comma-separated string into one param per value', () => {
    const { url } = buildRequest(descriptor, 'gmail', 'users.threads.get', {
      userId: 'me',
      id: 't1',
      format: 'metadata',
      metadataHeaders: 'From,Subject,Date,To',
    });

    const params = new URL(url).searchParams.getAll('metadataHeaders');
    expect(params).toEqual(['From', 'Subject', 'Date', 'To']);

    // The bug, stated precisely: one param whose value contains commas.
    expect(url).not.toContain('From%2CSubject');
  });

  it('passes an array through as repeated params', () => {
    const { url } = buildRequest(descriptor, 'gmail', 'users.messages.get', {
      userId: 'me',
      id: 'm1',
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    });

    expect(new URL(url).searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject']);
  });

  it('tolerates spaces after the commas', () => {
    const { url } = buildRequest(descriptor, 'gmail', 'users.threads.get', {
      userId: 'me', id: 't1', metadataHeaders: 'From, Subject ,Date',
    });

    expect(new URL(url).searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject', 'Date']);
  });

  it('does NOT split a comma inside a param that is not repeated', () => {
    // Drive's `q` is a single search string, and commas are legal inside it. Splitting
    // it would corrupt the query — the coercion must be driven by the descriptor, not
    // by the presence of a comma.
    const { url } = buildRequest(descriptor, 'drive', 'files.list', {
      q: "name contains 'a,b'",
    });

    expect(new URL(url).searchParams.getAll('q')).toEqual(["name contains 'a,b'"]);
  });
});
