/**
 * server.json is what the MCP Registry publishes, and it is only ever exercised at
 * release time — by a CI job, on a tag, after npm has already published. A field missing
 * or a version out of step fails there, which is the worst moment to find out.
 *
 * Everything here is offline and compares the file to what the repo already knows.
 * Deliberately not schema-validated with ajv: ajv is present only transitively via the
 * MCP SDK, so a dependency bump could remove the validator and silently take the check
 * with it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const server = JSON.parse(
  readFileSync(new URL('../../server.json', import.meta.url), 'utf-8'),
) as {
  name: string;
  title?: string;
  description: string;
  version: string;
  websiteUrl?: string;
  repository?: { url?: string; source?: string; id?: string };
  packages: { registryType: string; identifier: string; version: string; transport: { type: string } }[];
};

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
) as { name: string; version: string };

describe('server.json', () => {
  it('carries the version package.json does, in both places it appears', () => {
    // `make version-sync` writes all three. It has been wrong before: the file records the
    // version twice — once for the server entry, once for the npm package it points at —
    // and a mismatch publishes a registry entry naming a tarball that does not exist.
    expect(server.version).toBe(pkg.version);
    for (const p of server.packages) expect(p.version).toBe(pkg.version);
  });

  it('points at the npm package this repo actually publishes', () => {
    const npm = server.packages.find((p) => p.registryType === 'npm');
    expect(npm?.identifier).toBe(pkg.name);
    expect(npm?.transport.type).toBe('stdio');
  });

  it('tells people where the source is', () => {
    // Without this the registry lists a server with no way to inspect what it runs. The
    // schema calls that out: repository metadata is what lets users and security
    // reviewers read the code before installing it.
    expect(server.repository?.url).toBe('https://github.com/aaronsb/google-workspace-mcp');
    expect(server.repository?.source).toBe('github');
  });

  it('carries the forge id, not just the path', () => {
    // GitHub's own numeric id. It survives a rename, and it CHANGES if a repository is
    // deleted and recreated — which is how a registry detects someone recreating an
    // abandoned repo at the same path to inherit its reputation.
    expect(server.repository?.id).toMatch(/^\d+$/);
  });

  it('has a website and a human-readable title', () => {
    expect(server.websiteUrl).toMatch(/^https:\/\//);
    // A title is a NAME, not the description over again — some registry entries paste a
    // truncated description here and it reads as one in the listing.
    expect(server.title).toBeTruthy();
    expect(server.title!.length).toBeLessThan(40);
    expect(server.title).not.toBe(server.description);
  });

  it('names itself under the namespace the OIDC publish can claim', () => {
    // The registry grants io.github.<repository_owner>/* from the OIDC token's owner
    // claim (ADR-105). A name outside that namespace cannot be published by CI at all.
    expect(server.name).toMatch(/^io\.github\.aaronsb\//);
  });
});
