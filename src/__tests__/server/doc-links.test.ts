/**
 * scripts/check-doc-links.mjs guards against Markdown linking to files that do not
 * exist (#224). A guard only ever run against the real, clean repo cannot tell
 * "no broken links" from "finds nothing", so these fixtures make it fire.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/check-doc-links.mjs');

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'doc-links-'));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(resolve(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function run(root?: string) {
  const r = spawnSync(process.execPath, root ? [SCRIPT, root] : [SCRIPT], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('check-doc-links', () => {
  it('passes on the repository itself', () => {
    const r = run();
    expect(r.out).toMatch(/all resolve/);
    expect(r.status).toBe(0);
  });

  it('fails on a link to a missing file, naming file and line', () => {
    const root = fixture({
      'CONTRIBUTING.md': '# Hi\n\nSee [Architecture](ARCHITECTURE.md).\n',
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('CONTRIBUTING.md:3  ARCHITECTURE.md');
  });

  it('resolves links relative to the linking file, not the root', () => {
    // The docs/how-it-works.md defect: a root-relative path written inside docs/.
    const root = fixture({
      'docs/architecture/ADR.md': '# ADR\n',
      'docs/good.md': '[ok](architecture/ADR.md)\n',
      'docs/bad.md': '[broken](docs/architecture/ADR.md)\n',
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('docs/bad.md:1');
    expect(r.out).not.toContain('docs/good.md');
  });

  it('fails on a broken reference-style link, on the line it is defined', () => {
    const root = fixture({ 'README.md': 'See [the guide][g].\n\n\n\n[g]: docs/GUIDE.md\n' });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('README.md:5  docs/GUIDE.md');
  });

  // Each of these is a valid CommonMark link the first version of the checker never
  // matched, so a broken target passed. The badge shape is README.md's LICENSE link.
  it.each([
    ['a link wrapped around a badge image', '[![License](https://img.shields.io/x)](LICENSE-GONE)'],
    ['a single-quoted title', "[a](missing.md 'title')"],
    ['a parenthesised title', '[a](missing.md (title))'],
    ['an angle-bracket target with a space', '[a](<docs/no file.md>)'],
    ['brackets nested in the link text', '[see [x]](missing.md)'],
    ['an inline HTML link', '<a href="missing.md">a</a>'],
  ])('fails on %s', (_name, line) => {
    expect(run(fixture({ 'README.md': `${line}\n` })).status).toBe(1);
  });

  it('fails on a link whose case differs from the file, as the Linux CI runner would', () => {
    expect(run(fixture({ 'docs/foo.md': '# foo\n', 'README.md': '[a](docs/Foo.md)\n' })).status).toBe(1);
  });

  it('scans .markdown and upper-case extensions, and does not prune src/coverage', () => {
    for (const path of ['NOTES.MD', 'guide.markdown', 'src/coverage/n.md']) {
      const r = run(fixture({ [path]: '[a](missing.md)\n' }));
      expect(r.status, path).toBe(1);
    }
  });

  it('accepts valid links in shapes the first version reported as broken', () => {
    const root = fixture({
      'docs/foo(1).md': '# foo\n',
      'docs/no file.md': '# spaced\n',
      'docs/100%.md': '# percent\n',
      'README.md': [
        '[balanced](docs/foo(1).md)',
        '[g]: <docs/no file.md>',
        '[percent](docs/100%.md)',
        'A footnote[^1].',
        '',
        '[^1]: See the spec for details.',
      ].join('\n'),
    });
    const r = run(root);
    expect(r.out).toMatch(/3 relative links, all resolve/);
    expect(r.status).toBe(0);
  });

  it('ignores external links, anchors, and links that are not links', () => {
    const root = fixture({
      'docs/x.md': '# X\n',
      'README.md': [
        '[web](https://example.com/missing.md) [mail](mailto:a@b.c) [top](#install)',
        '[anchored](docs/x.md#section)',
        '`[inline](nope.md)`',
        '\\[escaped\\](nope.md)',
        '<!-- [commented](nope.md) -->',
        '```',
        '[fenced](nope.md)',
        '```',
        '````',
        '```',
        '[inside a longer fence](nope.md)',
        '````',
        '~~~',
        '[unterminated fence runs to the end](nope.md)',
      ].join('\n'),
    });
    const r = run(root);
    // One checked link proves the file was scanned; the rest were skipped, not missed.
    expect(r.out).toMatch(/1 relative links, all resolve/);
    expect(r.status).toBe(0);
  });
});
