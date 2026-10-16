/**
 * The preview gate (ADR-309): a write runs only with a token from a preview of that exact
 * write, on that account, recently, and returned in an earlier tool call.
 */
import { describe, expect, it } from 'vitest';

import { runAsToolCall } from '../../server/call-context.js';
import {
  PREVIEW_TTL_MS,
  canonicalJson,
  checkPreviewToken,
  describeTokenFailure,
  mintPreviewToken,
} from '../../server/preview-gate.js';

const KIND = 'gmail.filter.create';
const ACCOUNT = 'me@test.com';
const PAYLOAD = { criteria: { from: 'billing@vendor.test' }, action: { removeLabelIds: ['INBOX'] } };
const T0 = 1_800_000_000_000;

/** Mint in one tool call, as a real preview does. */
const minted = (payload: unknown = PAYLOAD, kind = KIND, now = T0) =>
  runAsToolCall(async () => mintPreviewToken(kind, ACCOUNT, payload, now));

describe('a token from an earlier call', () => {
  it('authorizes the exact payload it previewed', async () => {
    const token = await minted();
    expect(checkPreviewToken(token, KIND, ACCOUNT, PAYLOAD, T0 + 1000)).toEqual({ ok: true });
  });

  it('does not care about key order', async () => {
    const token = await minted({ action: { removeLabelIds: ['INBOX'] }, criteria: { from: 'billing@vendor.test' } });
    expect(checkPreviewToken(token, KIND, ACCOUNT, PAYLOAD, T0)).toEqual({ ok: true });
  });

  it('treats the account case-insensitively, as Gmail does', async () => {
    const token = await minted();
    expect(checkPreviewToken(token, KIND, 'Me@Test.com', PAYLOAD, T0)).toEqual({ ok: true });
  });
});

describe('a token is refused', () => {
  it('when absent', () => {
    expect(checkPreviewToken(undefined, KIND, ACCOUNT, PAYLOAD)).toMatchObject({ failure: 'missing' });
    expect(checkPreviewToken('  ', KIND, ACCOUNT, PAYLOAD)).toMatchObject({ failure: 'missing' });
  });

  it('when it is not one of ours', () => {
    expect(checkPreviewToken('nonsense', KIND, ACCOUNT, PAYLOAD)).toMatchObject({ failure: 'malformed' });
    expect(checkPreviewToken('a.b.c', KIND, ACCOUNT, PAYLOAD)).toMatchObject({ failure: 'malformed' });
  });

  it('when any part of the payload changed after the preview', async () => {
    const token = await minted();
    const edited = { ...PAYLOAD, action: { removeLabelIds: ['INBOX'], addLabelIds: ['TRASH'] } };
    expect(checkPreviewToken(token, KIND, ACCOUNT, edited, T0)).toMatchObject({ failure: 'mismatch' });
  });

  it('on another account', async () => {
    const token = await minted();
    expect(checkPreviewToken(token, KIND, 'other@test.com', PAYLOAD, T0)).toMatchObject({ failure: 'mismatch' });
  });

  it('when the header was edited, e.g. to extend its life', async () => {
    const token = await minted();
    const [, macPart] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ k: KIND, t: T0 + PREVIEW_TTL_MS, c: 1 })).toString('base64url');
    expect(checkPreviewToken(`${forged}.${macPart}`, KIND, ACCOUNT, PAYLOAD, T0 + PREVIEW_TTL_MS + 1))
      .toMatchObject({ failure: 'mismatch' });
  });

  it('for a different operation, and says which one it was for', async () => {
    // Sibling operations sign different payloads, as create and update do, so the kind
    // has to be named before the MAC fails on the payload.
    const token = await minted({ filterId: 'F1', before: PAYLOAD, spec: PAYLOAD }, 'gmail.filter.update');
    expect(checkPreviewToken(token, KIND, ACCOUNT, PAYLOAD, T0))
      .toMatchObject({ failure: 'wrong-kind', issuedFor: 'gmail.filter.update' });
  });

  it('after it expires', async () => {
    const token = await minted();
    expect(checkPreviewToken(token, KIND, ACCOUNT, PAYLOAD, T0 + PREVIEW_TTL_MS)).toEqual({ ok: true });
    expect(checkPreviewToken(token, KIND, ACCOUNT, PAYLOAD, T0 + PREVIEW_TTL_MS + 1)).toMatchObject({ failure: 'expired' });
  });

  it('in the same tool call that minted it, which is how a queue would chain preview into write', async () => {
    const result = await runAsToolCall(async () => {
      const token = mintPreviewToken(KIND, ACCOUNT, PAYLOAD, T0);
      return checkPreviewToken(token, KIND, ACCOUNT, PAYLOAD, T0);
    });
    expect(result).toMatchObject({ failure: 'same-call' });
  });
});

describe('the refusal', () => {
  it('names the preview to run for every failure', () => {
    for (const failure of ['missing', 'malformed', 'wrong-kind', 'mismatch', 'expired', 'same-call'] as const) {
      const text = describeTokenFailure({ ok: false, failure }, 'createFilter', 'previewFilter', 'It acts later');
      expect(text, failure).toMatch(/previewFilter|its own call/);
    }
  });

  it("gives the write's own reason when the token is missing", () => {
    expect(describeTokenFailure({ ok: false, failure: 'missing' }, 'w', 'p', 'It changes many things'))
      .toContain('`w` needs a previewToken. It changes many things, so it runs only after a preview');
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } }))
      .toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});
