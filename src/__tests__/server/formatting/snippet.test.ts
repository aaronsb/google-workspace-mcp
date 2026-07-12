/**
 * Gmail returns `snippet` HTML-escaped. We render snippets as plain text.
 *
 * So every preview containing an apostrophe or a quote arrived looking like machine
 * output: `codename &#39;lando&#39;, firmware 2.0.7`.
 */
import { describe, expect, it } from 'vitest';

import { decodeSnippet } from '../../../server/formatting/markdown.js';

describe('decodeSnippet', () => {
  it('decodes the entities Gmail actually emits', () => {
    expect(decodeSnippet('codename &#39;lando&#39;')).toBe("codename 'lando'");
    expect(decodeSnippet('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(decodeSnippet('&quot;quoted&quot;')).toBe('"quoted"');
    expect(decodeSnippet('a &lt;b&gt; c')).toBe('a <b> c');
  });

  it('decodes hex numeric references', () => {
    expect(decodeSnippet('&#x27;hi&#x27;')).toBe("'hi'");
  });

  it('decodes &amp; LAST, so an escaped entity is not double-decoded', () => {
    // `&amp;#39;` is a LITERAL "&#39;" that someone wrote in an email. Decoding &amp;
    // first would turn it into `&#39;` and then into an apostrophe — inventing a
    // character the sender never typed.
    expect(decodeSnippet('&amp;#39;')).toBe('&#39;');
  });

  it('leaves ordinary text alone', () => {
    expect(decodeSnippet('nothing to decode')).toBe('nothing to decode');
    expect(decodeSnippet('')).toBe('');
  });
});
