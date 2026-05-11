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

/**
 * Drop elements that are CSS-hidden — these are the prompt-injection vehicle.
 *
 * Each pattern terminates on `;`, `!` (for `!important`), or end-of-string,
 * since `display:none !important` is the canonical marketing-email form and
 * the original regex's `;`-only terminator missed it.
 */
function isCssHidden(_tag: string, attribs: Record<string, string>): boolean {
  if (attribs['aria-hidden'] === 'true') return true;
  // HTML5 boolean `hidden` attribute — semantically `display:none`, same threat.
  if (attribs.hidden !== undefined) return true;

  const style = (attribs.style ?? '').toLowerCase().replace(/\s+/g, '');
  if (!style) return false;

  // `display:none` / `visibility:hidden`, including !important.
  if (/(?:^|;)display:none(?:[;!]|$)/.test(style)) return true;
  if (/(?:^|;)visibility:hidden(?:[;!]|$)/.test(style)) return true;

  // opacity:0 (with optional decimal zeros). 0.01-style "almost zero" is left
  // alone — visually different and a legitimate styling value in normal email.
  if (/(?:^|;)opacity:0(?:\.0+)?(?:[;!]|$)/.test(style)) return true;

  // font-size:0 with any (or no) unit — px, em, rem, pt, %, vh, vw, ex, ch.
  if (/(?:^|;)font-size:0(?:\.0+)?[a-z%]*(?:[;!]|$)/.test(style)) return true;

  // Off-screen positioning. Negative ≥3 digits on any positioning axis OR a
  // negative text-indent in the same range; positive 3+ digits also catches
  // `text-indent:9999px` (off to the right of the viewport).
  if (/(?:^|;)(?:text-indent|left|right|top|bottom):-\d{3,}/.test(style)) return true;
  if (/(?:^|;)text-indent:\d{3,}/.test(style)) return true;

  // Collapsed boxes — width/height 0 (any unit). Combined with overflow:hidden
  // or even alone these render no visible content.
  if (/(?:^|;)(?:width|height|max-width|max-height):0(?:[a-z%]*)(?:[;!]|$)/.test(style)) return true;

  // Clip and clip-path zero-rect hide patterns.
  if (/(?:^|;)clip:rect\(0(?:px)?,0(?:px)?,0(?:px)?,0(?:px)?\)/.test(style)) return true;
  if (/(?:^|;)clip-path:inset\(50%\)/.test(style)) return true;

  // Transforms that hide content: scale(0), large negative translate.
  if (/(?:^|;)transform:scale\(0(?:\.0+)?(?:,\s*0(?:\.0+)?)?\)/.test(style)) return true;
  if (/(?:^|;)transform:translate(?:x|y)?\(-\d{3,}/.test(style)) return true;

  return false;
}

/** Runtime validation — the Spotlighting wrapper is forgeable if `source` is computed. */
const ALLOWED_SOURCES: ReadonlySet<SanitizeSource> = new Set([
  'gmail', 'docs', 'drive', 'scratchpad-import',
]);

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
  // Spotlighting wrapper integrity depends on `source` being one of the known
  // values — types vanish at runtime, so guard here in case a future caller
  // ever passes a config- or input-derived string.
  if (!ALLOWED_SOURCES.has(source)) {
    throw new Error(`sanitizeHtmlForAgent: invalid source ${JSON.stringify(source)}`);
  }
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
