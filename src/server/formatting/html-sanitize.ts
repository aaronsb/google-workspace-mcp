/**
 * Shared HTML sanitization for any agent-facing path that emits or ingests
 * HTML (Gmail message bodies, Docs HTML export, Drive HTML files, the
 * scratchpad html format from ADR-302). See ADR-305.
 *
 * Every layer here exists for a specific real-world attack:
 * 1. CSS-hidden subtrees ─ the most common prompt-injection pattern in
 *    marketing email; instructions are dropped into a `display:none` block
 *    so a human reader doesn't see them but an LLM consuming the markup does.
 * 2. Tag/attribute allowlist ─ blocks `<script>`, event handlers, dangerous
 *    URI schemes (`javascript:`, `data:`, `vbscript:`).
 * 3. Unicode injection chars ─ Tag Block (U+E0000–U+E007F), bidi overrides,
 *    zero-width spaces. Have been used to smuggle invisible instructions
 *    through human review.
 * 4. Spotlighting delimiters ─ wrap the sanitized output in a tagged block
 *    with the source and an "untrusted" marker. Microsoft's LLMail-Inject
 *    research found this alone drops injection success >50% → <2%; combined
 *    with sanitization it's stronger than either layer alone.
 *
 * Default-off in callers: the existing stripped-text path is unchanged.
 * Opt-in via `bodyFormat: 'html'` (or the equivalent on other ops).
 */

import sanitizeHtml from 'sanitize-html';

/** Untrusted source identifier — appears on the Spotlighting wrapper. */
export type SanitizeSource = 'gmail' | 'docs' | 'drive' | 'scratchpad-import';

interface SanitizeOptions {
  /** Where the HTML came from — surfaces on the Spotlighting wrapper. */
  source: SanitizeSource;
}

const ALLOWED_TAGS = [
  // block / structural
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'span', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'hr', 'br',
  // inline
  'b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup', 'small', 'mark',
  'a', 'img',
  'figure', 'figcaption',
];

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title'],
  // intentionally omitted everywhere else — no class, no id, no style, no event handlers
};

/** Drop elements that are CSS-hidden — these are the prompt-injection vehicle. */
function isCssHidden(_tag: string, attribs: Record<string, string>): boolean {
  if (attribs['aria-hidden'] === 'true') return true;
  const style = (attribs.style ?? '').toLowerCase().replace(/\s+/g, '');
  if (!style) return false;
  return (
    /(?:^|;)display:none(?:;|$)/.test(style) ||
    /(?:^|;)visibility:hidden(?:;|$)/.test(style) ||
    /(?:^|;)opacity:0(?:\.0+)?(?:;|$)/.test(style) ||
    /text-indent:-\d{4,}/.test(style) ||
    /left:-\d{4,}/.test(style) ||
    /right:-\d{4,}/.test(style) ||
    /font-size:0(?:px|em|rem)?(?:;|$)/.test(style)
  );
}

// Unicode characters that don't render but can carry meaning to an LLM.
// Tag Block (U+E0000–U+E007F): used in published prompt-smuggling attacks.
// Bidi overrides (U+202A–U+202E, U+2066–U+2069): can reorder visible text.
// Zero-width (U+200B–U+200D, U+2060, U+FEFF): hidden tokens.
// eslint-disable-next-line no-misleading-character-class
const INJECTION_CHARS = /[\u{E0000}-\u{E007F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu;

function stripInjectionChars(s: string): string {
  return s.replace(INJECTION_CHARS, '');
}

/**
 * Sanitize HTML before handing it to an agent-facing path.
 *
 * Returns a sanitized HTML string wrapped in a Spotlighting block. Safe to
 * embed directly in tool response text — the wrapper signals "untrusted
 * content" to the consuming model.
 *
 * Empty input returns an empty Spotlighting block (still wrapped, for
 * consistency — callers can compare against `''` to detect no-content).
 */
export function sanitizeHtmlForAgent(html: string, options: SanitizeOptions): string {
  const { source } = options;
  const input = html ?? '';

  const sanitized = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
    // Drop the whole subtree (contents + tags) when the filter returns true —
    // not just the wrapping tag. CSS-hidden injection text never reaches output.
    exclusiveFilter: (frame) => isCssHidden(frame.tag, frame.attribs ?? {}),
    // Disallow the contents of script/style/etc. — sanitize-html drops these
    // tags by default since they're not in allowedTags; we set this to be
    // explicit and to also drop the text content.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'head'],
    // Don't preserve self-closing forms we don't want; default config is fine
    // for the tags we allow.
  });

  const cleaned = stripInjectionChars(sanitized).trim();

  // Spotlighting: the wrapper tells the LLM "this is content, not instruction".
  // Microsoft LLMail-Inject (NeurIPS 2024) found this single technique drops
  // injection success from >50% to <2% even before sanitization.
  return `<${source}_content trust="untrusted">${cleaned}</${source}_content>`;
}
