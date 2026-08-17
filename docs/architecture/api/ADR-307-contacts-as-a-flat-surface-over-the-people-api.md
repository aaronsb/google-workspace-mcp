---
status: Accepted
date: 2026-08-17
deciders:
  - aaronsb
related:
  - ADR-103
  - ADR-202
  - ADR-300
---

# ADR-307: Contacts as a flat surface over the People API

## Context

"Who is this person and how do I reach them" is a question an agent asks constantly, and
until now the server could not answer it. Contacts was sequenced deliberately behind
ADR-202: contact data is the most personal thing in a Workspace account, so the tool
arrives after the machinery that lets an account be authorized read-only, rather than
before it.

Three things about the People API shape this design, and all three are the kind of fact
that a green test suite cannot tell you.

### A Person is parallel arrays, not fields

A name is not a string. It is `names: [{ displayName, metadata: { primary } }, ...]`, and
every field works the same way — one array per field, each entry carrying its own
metadata, and the entry that counts flagged rather than ordered first. Handed to the
generic formatter, a person renders with no name and no address: the same failure as a
Docs read that returned metadata and no text.

Ordering is the sharp edge. Google does not put the primary entry first; it marks it. On
a contact with a work address and a personal one, taking `[0]` is a coin flip over which
address a reply goes to.

### Every read must name the fields it wants

`personFields` and `readMask` are not optimizations. Omit the mask and the call is
rejected outright — this is not a shape that degrades to a sensible default. The legal
mask also differs per operation: `otherContacts` refuses `organizations`, which is a 400
rather than an empty column.

### "Sources" means two different things

The contact operations take `READ_SOURCE_TYPE_*`; the directory operations take
`DIRECTORY_SOURCE_TYPE_*`, and the directory operations *require* it. Since
`generateSchema` keeps only the first declaration of a parameter name across a service's
operations (ADR-300), a single advertised `sources` enum would be silently wrong for
whichever half lost the race.

### Search returns nothing until the cache is warmed

Google states it on both search methods, in the Discovery document this server generates
from: *"Before searching, clients should send a warmup request with an empty query to
update the cache."* A first search without one comes back empty — indistinguishable from
"you have no contact by that name", and the most convincing wrong answer this tool could
give.

## Decision

`manage_contacts` exposes **ten operations over flat scalar parameters**. The masks, the
source types, the sort constants, `people/me`, the etag, `updatePersonFields` and the
Person body shape do not appear in the schema at all.

```
list             people.connections.list        your saved contacts
search           people.searchContacts
get              people.get                     one person in full
create           people.createContact           save a new contact
update           people.updateContact           change one
delete           people.deleteContact
listOther        otherContacts.list             addresses seen in mail, never saved
searchOther      otherContacts.search
listDirectory    people.listDirectoryPeople     the organization directory
searchDirectory  people.searchDirectoryPeople
```

The agent supplies `operation`, `email`, and flat scalars: `query`, `contactId`,
`maxResults`, `pageToken`, `sortOrder` for reads, and `name`, `contactEmail`, `phone`,
`company`, `jobTitle`, `notes` for writes. Everything else the API demands is supplied by
the manifest's `defaults` or built in `beforeExecute`, and never enters the generated
schema.

This is the factory principle applied rather than bent: *simple for the agent, the tool
absorbs the routing*. Four response envelopes (`connections`, `otherContacts`, `people`,
`results[].person`) collapse to one rendered list. Three sort constants become
`firstName` / `lastName` / `lastModified`, translated in `beforeExecute` — and refused
there, loudly, if a value arrives that the map does not cover, because the low-level MCP
handler does not validate against `inputSchema` and an untranslated value would reach
Google verbatim.

The warmup is absorbed the same way: both search operations fire it in `beforeExecute`,
once per account per process, and a warmup that fails is swallowed rather than raised —
if it failed for a reason that matters, the real search is about to fail the same way and
say so properly.

The writes travel the same road in reverse. `create` advertises flat scalars and
`beforeExecute` assembles the Person — because anything sent that Google does not
recognise as a query parameter lands in the request body **verbatim**, so a flat `name`
is accepted, ignored, and returns 200 with a nameless contact. That failure contains no
error anywhere. The same hook refuses a `create` with every field empty, which Google
would otherwise accept, storing a record whose only content is its id.

### `update` derives what it is allowed to touch

`updatePersonFields` **replaces** every entry in each field it names, and naming a field
with nothing in the body **clears** it. That is #161's shape — `calendar.attendees`
silently replacing a whole list — with a sharper edge: the field list is not something
the caller passes, it is something this code derives. Derive it wrong and the operation
destroys data the caller never mentioned.

So it is built from exactly which parameters arrived. Declared statically, this operation
would wipe a contact's phone number every time someone corrected a job title.

Google also requires the current `etag` and rejects the call without it, which makes
`update` a read-modify-write rather than a patch. The contract the schema states, rather
than leaving to be discovered:

| the caller | the field |
|---|---|
| omits it | untouched, and not named in `updatePersonFields` |
| passes a value | replaced entirely |
| passes an empty string | named, left out of the body, and so cleared |

`company` and `jobTitle` write to the **same** Person field, so writing either rewrites
the whole `organizations` array. The read half of the read-modify-write already holds the
current value, so the existing entries are carried through and only the two named keys
are overwritten — including the subfields this tool never exposes (`department`, `type`,
`startDate`) and any organization after the first.

Rebuilding that array from the two parameters instead is a loss that looks like a
success: correcting a job title erases an employment record, and the confirmation renders
only name and title, so it reads exactly right.

One case stops before the write rather than choosing between two losses. Google **returns**
`organizations[].startDate` and `endDate` and then **rejects** them, answering
`500 Internal error encountered` on create and update alike — measured, with every other
subfield probed (`department`, `type`, `jobDescription`, `symbol`, `domain`, `location`,
`phoneticName`, `costCenter`, `current`) round-tripping fine. Carrying such a field
through fails with a 500 that says nothing about why; dropping it loses employment history
nobody asked to change. So an organization edit on such a contact is refused with a
sentence naming the field, the cause, and what to do — and only that edit: every other
field on the same contact still updates, because `organizations` is rebuilt only when
`company` or `jobTitle` is passed.

A parameter that arrives as something other than a string is **refused**, not dropped.
The two halves of a write are derived from different facts — `updatePersonFields` from
whether the parameter arrived, the body from whether it holds a usable string — and
anything present-but-unusable splits them, naming a field with nothing behind it, which
is how Google is told to delete it. Dropping a number silently would answer a request to
set a phone number by deleting the one already there, and report success.

### `delete` is resolved by how the policy is switched on

`no-delete` is **opt-in**, via `GWS_SAFETY_POLICY`. Registering `people: ['delete']` in it
means an operator who asked for no permanent deletion gets contacts covered, and one who
did not keeps the operation. Whether Google's own trash would have caught the contact is
not the question that operator asked, so it does not have to be answered here.

### Scoped in three parts

Its scopes are three, because Google gates each collection separately, and only the first
has a write form:

| collection | read/write | read |
|---|---|---|
| your contacts | `contacts` | `contacts.readonly` |
| other contacts | `contacts.other.readonly` | same |
| directory | `directory.readonly` | same |

So a contacts account authorized `access: 'read'` under ADR-202 reaches all seven reads
and is refused `create` by Google. That is the mapping doing its job, and it is why this
tool was sequenced behind ADR-202 rather than in front of it.

### The enum guard moves rather than lapses

The suite already refuses to advertise a value Google would reject (added with the Meet
spaces work, after `MODERATION_ON` shipped where Google wanted `ON`). `sortOrder`
advertises values Google has never heard of, so a naive guard would fail on it.

Waiving the check for translated params would put the first hole in it. Instead the check
moves to the far side of the translation: a registry names the real map, and the test
asserts that every advertised value maps, and that every mapped value is one Google
declares. Both halves were verified by breaking them.

## Consequences

### Positive

- An agent can answer "how do I reach Dana" in one call, with no knowledge of field masks,
  source constants, or which of four envelope keys this operation used.
- The three collections are distinct operations rather than a flag, so "search my
  contacts" and "search the company directory" are different questions with different
  scopes — and an account can hold one without the other.
- Contacts arrives already compatible with per-account read-only authorization, which was
  the reason for sequencing it here.

### Negative

- The masks are a policy decision baked into the manifest. A caller who wants a field
  outside the chosen set cannot ask for it; widening the mask is a code change.
- Seven operations is the largest read-only surface in the server, and the directory pair
  is inert on a personal Google account — it answers with an error that has nothing to do
  with the caller's request.
- Adding contacts to an existing account requires re-consent. The scopes are new, so every
  already-authorized account must pass through `manage_accounts scopes` before
  `manage_contacts` can call anything.

### Neutral

- `update` costs an extra round trip on every call, for the etag. There is no way to skip
  it: Google rejects an update without one.
- One field of a contact is still unreachable per call by design. `contactEmail` and
  `phone` are single scalars, so a contact with four addresses cannot be edited down to
  three — only replaced with one, or cleared. Editing a multi-valued field entry by entry
  would need the array back in the schema, which is the shape this ADR exists to keep out.
- Photos, addresses, birthdays, relations and URLs are readable and not writable. `get`
  returns them; no parameter sets them.
- `people.get` needs `profile`, not merely `userinfo.email` — measured, on an account that
  held the latter and was refused. Nothing in this tool depends on that, but it rules out
  probing the Person shape without full consent.
- **All ten operations exercised against live Google**, on a personal account and two
  Workspace ones, including a full write lifecycle: create → add a phone → clear the phone
  → delete → 404, with the search index agreeing at each step.

  Confirmed: every field mask is accepted as written; the `sources` pair returns the
  domain directory; the `maxResults` clamps (30 search, 100 list) are within Google's
  ceilings — a request for 500 clamped to 100 and returned 91 rather than erroring;
  `people/me` resolves; bare ids normalize; prefix matching behaves as the parameter
  description claims (`ockelie` finds nobody, `Bockelie` finds ten); an empty string
  really does clear a field; and both updates left every field the caller did not mention
  untouched, which is the derived `updatePersonFields` doing its job.
- Whether the **warmup is strictly required** remains unmeasured. It is documented by
  Google on both search methods, it is always sent, and no account here has ever searched
  without it — so nothing observed distinguishes "the warmup worked" from "the warmup was
  unnecessary". It costs one cached round trip per account.
- `listDirectory` on a personal account answers `400 FAILED_PRECONDITION — Must be a
  G Suite domain user`. Legible enough to leave alone, and the operation descriptions say
  "Workspace accounts only".
- Directory people carry a different id space from contacts: `people/107200152696692539125`
  rather than `people/c36`. Both are opaque to the caller and both round-trip through
  `get`.

## Alternatives Considered

- **One `search` operation with a `scope: contacts|other|directory` flag.** Fewer
  operations, and it hides the fact that the three are gated by different OAuth scopes.
  An agent that gets a directory error would have no way to see that its account was never
  authorized for directory reads.
- **Expose `personFields` / `readMask` as parameters.** Faithful to the API and hostile to
  the caller: it makes every contact lookup start with a schema question, and the legal
  values differ per operation, so the one advertised description would be wrong somewhere.
- **Expose `sources` with Google's enum.** Rejected because the enum is not one enum. The
  first declaration would win and silently mislabel the other half.
- **Advertise Google's sort constants verbatim** and skip the translation. Simpler code,
  and it leaks `LAST_MODIFIED_DESCENDING` into a tool whose other parameters read like
  English. The translation is four lines and one registry entry.
- **Wait for the call-time access policy** before adding contacts. Rejected: the consent
  half of ADR-202 is what contacts needed, and it has shipped. The call-time half changes
  the error an account sees, not what it is allowed to do.
