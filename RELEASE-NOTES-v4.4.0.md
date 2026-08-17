# v4.4.0

## Do many things at once, and give an account less power

### 🔁 `queue_operations` is now `bulk_operations`

Same tool, better name — it was named after one of its two strategies. **The old name still works** and will keep working for at least one more release, so nothing you have configured breaks.

It now has two modes.

**`mode: 'queue'`** (the default, unchanged) runs different operations in sequence, feeding each result into the next with `$N.field`. Works with every tool.

**`mode: 'batch'`** does *one* operation across many resources in a single Google request:

```
bulk_operations { mode: 'batch', tool: 'manage_email', operation: 'trash',
                  items: ['msg1', 'msg2', 'msg3', … ] }
```

Two hundred messages trashed in one round trip instead of two hundred.

Anything shared by the whole batch goes at the top level; `items` carry only what differs, and a bare id is enough when that's all it is. Batching is narrow on purpose — it works only where Google publishes a method for it, which today is **contacts** (create, update, delete, get) and **Gmail** (trash, label changes). Ask anywhere else and the answer names the operations that can, then points you back at sequential mode, which works everywhere.

Bulk **trash** is included; bulk permanent *delete* is not. Gmail's delete bypasses the trash and accepts only `https://mail.google.com/` — the broadest scope Gmail publishes. Supporting it would mean asking every account for full mailbox authority to gain an operation whose only advantage over trash is that it can't be undone.

### 🔒 Read-only accounts are now enforced, with an explanation

v4.3.0 let you authorize an account read-only. This release makes a write from that account fail *here*, before the request leaves, instead of arriving as a Google 403 you have to decode:

```
'create' needs write access to contacts. Account you@example.com was authorized
read-only for contacts. Re-authorize with manage_accounts {operation:'scopes',
email:'you@example.com', services:'contacts', access:'readwrite'}, or use an
account that already has it.
```

It also catches a case that always existed: an account that never authorized a service now gets told so, rather than an opaque 403.

This is on by default and does nothing to a normal read/write account — it enforces the choice *you* made at consent time, so it doesn't need a second opt-in. The check derives from Google's own per-method scope list, so an operation added tomorrow is covered without anyone maintaining a list.

**Verified against live Google**, including the part that matters most: with a read-only token, selecting *everything* on Google's consent screen still yields read-only access. The narrowing happens in the request, not in what you click.

### 🛡️ `manage_scratchpad` respects safety policies

Its send and sync paths wrote to Gmail, Docs, Sheets, Calendar and Tasks without consulting the safety layer, because it isn't a generated tool. Two consequences, now fixed:

- A read-only account refused `manage_docs write` could write the same content through `manage_scratchpad send`.
- With `GWS_SAFETY_POLICY=draft-only-email`, mail could still be sent through the scratchpad — and Google accepted it, because the token was legitimately broad. A policy that exists to stop an agent sending mail was one tool call from being bypassed.

### Also

- **Documentation matches reality again.** Every count in the README and coverage pages was stale — 95 operations reaching 79 of Google's 257 methods across eight APIs, not 80 of 233 across seven. Contacts is no longer listed as an API this server doesn't touch.
- **Coverage can't drift silently.** Four offline checks now compare `coverage-baseline.json` against the committed API descriptor on every build. The file had been stale for a month, missing an entire service, using a key the code had renamed.
- CI runs on Node 24 with current actions. The supported Node floor is **unchanged at 22.12**.

---

### On testing

Batch mode had fifteen passing tests and was broken in four of its six operations. Calling Google found all four: flat fields rejected outright, updates failing without an etag, bulk trash failing on a missing path parameter, and batch reads throwing away the very data they had fetched. Every operation in this release was then run against live Google — including a full contact lifecycle and a bulk trash of real messages, restored afterwards.
