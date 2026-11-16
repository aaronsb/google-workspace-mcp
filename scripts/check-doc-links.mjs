#!/usr/bin/env node
/**
 * Asserts every relative link in the repo's Markdown points at a file or directory that
 * exists, with the exact case it is written in.
 *
 * CONTRIBUTING.md once linked ARCHITECTURE.md, docs/API.md, docs/ERRORS.md and
 * docs/EXAMPLES.md, none of which existed, and nothing noticed until a reader followed
 * them (#224). Prose has no compiler: a document that tells a reader where to go next
 * drifts silently once the thing it names moves. This catches the link half of that.
 *
 * What it checks: inline links and images, including a link wrapped around a badge
 * image (`[![alt](img)](target)`), reference definitions, and `href`/`src` attributes
 * in inline HTML. Fenced code, inline code and HTML comments are skipped.
 *
 * What it does NOT catch:
 *   - a file named in plain text or a code block rather than linked (the Dockerfile in
 *     `docker build .`, "update CHANGELOG.md"). That still needs a human reading the doc.
 *   - whether a #fragment names a real heading.
 *   - links inside indented (4-space) code blocks, which it cannot tell apart from list
 *     continuations without a real Markdown parser. It errs towards checking them.
 *
 * Case matters: macOS resolves `docs/Foo.md` to `docs/foo.md`, the Linux CI runner does
 * not, so an existence check alone goes green locally and red in CI.
 *
 * Usage: node scripts/check-doc-links.mjs [root]
 *   root defaults to the repo. Scans every *.md / *.markdown file under it, skipping
 *   node_modules anywhere, the root-level build/, coverage/ and mcpb/server/ outputs, and
 *   dot-directories other than .github.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, relative, join, sep } from 'node:path';

const ROOT = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));

// Root-relative, not by basename: a basename skip would also prune src/coverage/ — the
// trap scripts/check-test-gates.mjs documents.
const SKIP_PATHS = new Set(['build', 'coverage', join('mcpb', 'server')]);

function* markdownFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (SKIP_PATHS.has(relative(ROOT, full))) continue;
      yield* markdownFiles(full);
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      yield full;
    }
  }
}

/**
 * Blank out everything that is not prose, keeping every newline so line numbers hold:
 * fenced code (a fence closes only on the same character, at least as long, and an
 * unterminated fence runs to the end of the file, as CommonMark has it), HTML comments,
 * and inline code.
 */
function stripNonProse(text) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const lines = text.split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !lines[i].slice(m[0].length).trim()) fence = null;
      lines[i] = blank(lines[i]);
    } else if (m) {
      fence = m[1];
      lines[i] = blank(lines[i]);
    }
  }
  return lines
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(`+)[^`]*?\1/g, blank);
}

// The target of `](target)`, anchored on the closing bracket rather than the opening one,
// so `[![badge](img)](target)` checks both and `[see [x]](target)` still matches. Allows
// <angle targets with spaces>, one level of balanced parentheses, and "", '' or () titles.
// An escaped `\]` is not a link.
const TARGET = String.raw`(<[^<>\n]*>|(?:[^\s()<>]|\([^\s()]*\))+)`;
const TITLE = String.raw`(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?`;
const INLINE = new RegExp(String.raw`(?<!\\)\]\(\s*${TARGET}${TITLE}\s*\)`, 'g');
// `[label]: target`, at most 3 spaces of indent; `[^1]:` is a footnote, not a link.
const REFERENCE = new RegExp(String.raw`^[ \t]{0,3}\[(?!\^)[^\]\n]+\]:[ \t]*${TARGET}`, 'gm');
const HTML = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * True if `path` exists with exactly this spelling, segment by segment below ROOT. The
 * spelling of ROOT itself is the caller's business; a link that climbs out of the repo
 * gets the plain existence check.
 */
function existsExactly(path) {
  if (!existsSync(path)) return false;
  const rel = relative(ROOT, path);
  if (rel.startsWith('..')) return true;
  let dir = ROOT;
  for (const segment of rel.split(sep).filter(Boolean)) {
    if (!readdirSync(dir).includes(segment)) return false;
    dir = join(dir, segment);
  }
  return true;
}

const broken = [];
let checked = 0;

for (const file of markdownFiles(ROOT)) {
  const text = stripNonProse(readFileSync(file, 'utf8'));
  for (const re of [INLINE, REFERENCE, HTML]) {
    for (const match of text.matchAll(re)) {
      const raw = match[1] ?? match[2];
      const target = raw.replace(/^<|>$/g, '');
      if (!target || EXTERNAL.test(target)) continue;
      let path = target.replace(/[#?].*$/, '');
      try {
        path = decodeURIComponent(path);
      } catch {
        // A literal `%` that is not an escape: GitHub serves the path as written.
      }
      if (!path) continue;
      checked++;
      const resolved = path.startsWith('/') ? join(ROOT, path) : resolve(dirname(file), path);
      if (!existsExactly(resolved)) {
        const line = text.slice(0, match.index + match[0].indexOf(raw)).split('\n').length;
        broken.push(`${relative(ROOT, file)}:${line}  ${target}`);
      }
    }
  }
}

if (broken.length) {
  console.error(`check-doc-links: ${broken.length} broken relative link(s):`);
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`check-doc-links: ${checked} relative links, all resolve`);
