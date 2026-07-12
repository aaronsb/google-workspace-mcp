# API Coverage

This server exposes a **curated subset** of Google's API surface — the operations useful to an agent in conversation, with LLM-friendly descriptions, sensible defaults, and shaped responses. It is not a 1:1 passthrough of every Google method.

**→ [The full API surface](api-surface.md)** — every method Google publishes, what it does, whether we expose it, and a one-click link to request it.

That page is generated from Google's [Discovery documents](https://developers.google.com/discovery), the same machine-readable specification the client itself is built from. So the denominator is Google's, not an estimate, and the numbers on it cannot quietly drift from reality.

## Why a subset, and not everything?

Because an agent has to *choose* among these, and every method it must consider is a method it can pick wrongly. A tool exposing all 233 methods is not more capable than one exposing 80 — it is harder to use correctly, and the descriptions alone would burn more context than most conversations can spare.

Most of what's uncovered is genuinely not agent work: domain administration, delegation and forwarding settings, per-label colour management, push-notification watch channels, batch-import endpoints. The covered slice is the "do useful work in a conversation" set.

Coverage is also not a race. A gap is not a bug. Some gaps are deliberate, and `coverage-baseline.json` records those as `"status": "excluded"` with a reason, so regeneration does not keep re-offering them as work.

But that judgement was made without you, and it may be wrong for what you're doing.

## Whole APIs we don't touch yet

Beyond the seven APIs above, Google publishes others this server does not target at all — **Chat, Contacts (People), Slides and Forms**, listed under [Not targeted yet](api-surface.md#not-targeted-yet) with the same per-method Request links.

They are listed rather than quietly omitted because *not targeted* is a decision, and it was made without you. They are not equally easy, and the difference is worth knowing before you ask:

| API | | |
|---|---|---|
| **Contacts** (People) | ordinary OAuth scopes, works on a personal account | straightforward |
| **Slides**, **Forms** | small, self-contained surfaces (5 and 10 methods) | straightforward |
| **Chat** | much of the API is built for Chat *apps* (bots) rather than for acting as yourself; user-credential access is narrower and in places Workspace-only | uncertain — a personal `@gmail.com` account may not be able to call it at all |

A request that names a concrete task is what turns one of these into work. It also tells us *which* methods matter — "find this person's phone number" needs two People methods, not all twenty-four.

## Asking for a method

Find it on **[the API surface page](api-surface.md)** and click **Request**. It opens an issue pre-filled with the method, its HTTP verb, and Google's own description, so you don't have to look any of that up.

Then it asks you the only question that actually decides the answer:

> **What do you want to do that you can't do today?**

**A good request names the task, not the method.** "I want the agent to file incoming invoices into a folder automatically" is a case — it can be evaluated, and it might turn out that an existing operation already does it, or that the right answer is a different method than the one you found. "Expose `users.settings.filters.create`" is not a case; it's a conclusion. Lead with the problem and let the method follow.

The second question — *why doesn't an existing operation cover it?* — is not a hurdle. It is the fastest way to find out that you didn't need a new method at all, which is a better outcome for you than waiting for one.

What makes a request persuasive:

- **A concrete task.** Something you tried to get an agent to do, and what happened instead.
- **Why the existing surface falls short.** Which operation you reached for, and where it stopped.
- **A reason it belongs in an agent's hands.** Some Google methods are administrative or destructive at a scale that no conversation should reach casually. That doesn't make them off-limits, but it raises the bar.

## Adding one yourself

Coverage grows by editing YAML, not by writing code.

Add an entry to the right `src/factory/manifest/<service>.yaml`. The generated descriptor already knows the method's path, HTTP verb, parameters, and scopes — nothing is transcribed by hand, so nothing can drift from Google. The factory generates the tool schema and the handler; new operations get default formatting automatically. Add a patch only when an agent needs a shaped response rather than a raw one.

An operation naming a method Google does not publish is a **compile error** — method names are generated into a TypeScript union from the descriptor.

Then:

```bash
make manifest-lint    # validate the manifest
make check            # type-check, lint, test, build, smoke
```

`make check` includes a guard that every write operation can actually carry a request body — an operation that can only ever send an empty `POST` will create blank resources or fail with an error that looks like Google's fault, so it is refused at build time.

## Regenerating

| Command | What it does |
|---|---|
| `npm run generate-api-surface` | Rewrites [api-surface.md](api-surface.md) from Google's live Discovery documents. |
| `npm run generate-descriptor` | Regenerates `src/google/descriptor.json`. A CI drift gate runs this with `--check` and fails if the committed artifact is stale. |
| `make coverage` | Prints the coverage table, every uncovered operation, and every parameter gap in a covered operation. |
| `make coverage-update` | Writes the result to `coverage-baseline.json`. |

The surface is always read from Google's published specification, never from anything human-readable. A regex over help-text prose once captured `calendars.The` — a word from a wrapped description line — and recorded it in the baseline as a genuine uncovered method, offered to contributors as work. Measure against the spec, not against prose.
