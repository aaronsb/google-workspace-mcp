# How it works

You don't need any of this to use the server — see the [README](../README.md) to install it.
This is for people who want to know what's underneath, or who want to add an operation.

## The two phases

Two phases. Google's API specification is acquired at **build time** and frozen into a committed artifact; at **runtime** the server only reads it.

### Build time — acquire the specification

```mermaid
flowchart LR
    disco["Google Discovery<br>documents"] --> gen["descriptor generator<br>generate-descriptor.mjs"]
    gen --> desc[("src/google/descriptor.json<br>233 methods · committed<br>paths · verbs · params · scopes")]
    desc --> gate{{"CI drift gate<br>regenerate and compare"}}

    classDef external fill:#f6821f,color:#1a1a1a,stroke:#d97706
    classDef process  fill:#2d7d9a,color:#ffffff,stroke:#4a5568
    classDef artifact fill:#2d8e5e,color:#ffffff,stroke:#4a5568
    classDef guard    fill:#fbbf24,color:#1a1a1a,stroke:#d97706
    class disco external
    class gen process
    class desc artifact
    class gate guard
```

### Runtime — dispatch against it

```mermaid
flowchart LR
    mcp["MCP client"] -->|stdio| factory["factory generator<br>schemas + handlers"]
    manifest["manifest/*.yaml<br>which ops to expose"] --> factory
    factory --> patches["patches<br>Gmail hydration · agenda merge · MIME"]
    patches --> client["Google API client<br>+ account router"]
    desc[("descriptor.json")] -. read at startup .-> client
    client --> google["Google REST APIs"]

    classDef external fill:#f6821f,color:#1a1a1a,stroke:#d97706
    classDef artifact fill:#2d8e5e,color:#ffffff,stroke:#4a5568
    classDef config   fill:#fbbf24,color:#1a1a1a,stroke:#d97706
    classDef core     fill:#7c3aed,color:#ffffff,stroke:#8b5cf6
    classDef inert    fill:#475569,color:#ffffff,stroke:#94a3b8
    class google external
    class desc artifact
    class manifest config
    class factory,patches,client core
    class mcp inert
```

**The descriptor** is generated from Google's Discovery documents and committed. A CI drift gate re-generates it and fails if the result differs, so the spec we dispatch against cannot silently fall behind Google.

**The client** (`src/google/client.ts`) is deliberately opinion-free: it builds the request Google's spec describes and returns exactly what Google returned. It does not reshape responses. All interpretation lives in patches and formatters, aimed at the MCP contract — which is what keeps "what Google said" and "what we chose to show" separable.

**The factory** reads the YAML manifest and generates MCP tool schemas and handlers at startup. **Patches** add behavior where an agent needs more than a raw API response — hydrating Gmail search results with senders and subjects, merging an agenda across calendars, building MIME for outbound mail. Operations without a patch get sensible defaults.

Because method names are generated into a TypeScript union, calling a method Google doesn't publish is a **compile error**, not a 404 at runtime.

## Adding an operation

The coverage mapper diffs what the manifest exposes against what Google actually publishes, so the frontier is always measured rather than estimated:

```bash
npm run generate-descriptor   # re-read Google's Discovery documents
make coverage                 # what we expose vs. what Google offers
make manifest-lint            # validate the curated manifest
make check                    # type-check, lint, test, build, smoke
```

To expose a new operation, add it to the relevant `src/factory/manifest/*.yaml`. The descriptor already knows its path, verb, parameters, and scopes, and the factory generates the tool schema and handler. New operations get default formatting automatically — add a patch only when an agent needs a shaped response rather than a raw one.

## Design

The server generates its API client from Google's own Discovery documents and calls Google directly. Nothing sits between the server and the API it targets: there is no subprocess, no second response shape, and no unversioned wrapper to keep in step. The descriptor is regenerated and diffed against Google on every build, so a method that does not exist is a compile error rather than a runtime surprise.

On top of that sits the manifest-driven tool factory: adding an operation is a YAML edit, not a code change. The coverage mapper reads Google's real published surface, so "what we expose vs what exists" is a measured number.

The reasoning behind this design, including what was verified and what it cost, is in **[ADR-103](docs/architecture/core/ADR-103-generate-a-google-api-descriptor-retire-the-gws-facade.md)**.
