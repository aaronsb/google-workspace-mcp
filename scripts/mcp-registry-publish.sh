#!/usr/bin/env bash
# Idempotent MCP Registry publish, shared by CI (npm-publish.yml) and the
# Makefile fallback (publish-all). Set MCP_PUBLISHER to the publisher binary
# (default: mcp-publisher on PATH).
#
# The already-published pre-check filters by EXACT server name:
# /v0/servers?search= is a substring match, so without the filter any
# similarly named server carrying the same version number would make this
# skip the real publish while staying green.
#
# The pre-check is a read-only convenience, so a failure of the search
# endpoint must not block a release — on any probe failure this falls
# through and lets `mcp-publisher publish` be the authority. An attempt to
# republish an existing version fails there, loudly, which is the correct
# residual behavior for the rare probe-missed case.
set -uo pipefail

MCP_PUBLISHER="${MCP_PUBLISHER:-mcp-publisher}"
NAME=$(node -p "require('./server.json').name")
VERSION=$(node -p "require('./server.json').version")

published=$(curl -fsSL "https://registry.modelcontextprotocol.io/v0/servers?search=${NAME}&limit=100" 2>/dev/null \
  | node -e '
      let s = "";
      process.stdin.on("data", d => s += d).on("end", () => {
        let j;
        try { j = JSON.parse(s); } catch { process.exit(0); }
        const name = process.argv[1];
        const versions = (j.servers || [])
          .filter(x => (x.name || (x.server && x.server.name)) === name)
          .map(x => x.version || (x.server && x.server.version))
          .filter(Boolean);
        console.log(versions.join(" "));
      });
    ' "$NAME" 2>/dev/null) || published=""

echo "already on the registry for ${NAME}: ${published:-<none, or the probe failed>}"
for v in $published; do
  if [ "$v" = "$VERSION" ]; then
    echo "$NAME $VERSION is already published — nothing to do."
    exit 0
  fi
done

exec "$MCP_PUBLISHER" publish server.json
