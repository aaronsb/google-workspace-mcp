# Security Policy

This is a volunteer project. Reports with a working reproduction are reviewed as time allows. Reports that come with a proposed fix or a pull request are prioritized.

## Reporting a Vulnerability

Report privately through GitHub: **[Report a vulnerability](https://github.com/aaronsb/google-workspace-mcp/security/advisories/new)** (Security tab → Advisories → Report a vulnerability). Do not open a public issue.

The form creates a private draft advisory visible only to you and the maintainer. Fill in:

- **Description** of the issue and its impact
- **Reproduction** that works against the latest release: steps, inputs, and what you observed. Reports without one may be closed.
- **Affected versions**, if you have narrowed them down
- **CWE and CVSS** you believe apply
- **Proposed fix**, if you have one. A fix can be developed in the advisory's temporary private fork, so it does not need to be public before the release.

If you cannot use GitHub, email aaronsb@gmail.com with a subject starting `[SECURITY]`.

## Supported Versions

Fixes land in the latest release only. Upgrade to the current version on [npm](https://www.npmjs.com/package/@aaronsb/google-workspace-mcp) or [GitHub Releases](https://github.com/aaronsb/google-workspace-mcp/releases) before reporting.

## Scope

In scope: defects in this server's code, such as

- exposure of OAuth tokens or client credentials
- reading or writing local files outside the paths a tool is meant to touch
- a tool acting on a different account, or with broader effect, than its arguments state
- injection through tool arguments into Google API queries or local commands

Out of scope:

- Google's own services and APIs
- attacks that require prior control of the user's machine, config files, or token store
- an AI agent calling tools the user enabled, with arguments the tool documents. The MCP client decides which calls run.
- findings from automated scanners without a demonstrated, reproducible impact on this server

## What Happens Next

There is no response-time guarantee. A report is accepted, rejected, or answered with questions in the advisory thread. Rejected reports stay private.

For an accepted report, the fix ships in a release and the advisory is published after it. Reporters are credited unless they ask not to be.

## CVEs

CVEs are requested at the maintainer's discretion, through GitHub as the CVE Numbering Authority, from the published advisory. A report does not by itself entitle anyone to a CVE. The advisory is the authoritative record of affected versions, severity, and description.
