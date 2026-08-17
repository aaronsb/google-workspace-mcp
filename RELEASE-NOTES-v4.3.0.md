# v4.3.0

## Contacts, and per-account read-only access

Two features that were built to arrive together.

### 🆕 `manage_contacts` — Google Contacts, via the People API

Ten operations across the three collections Google keeps separate:

| | |
|---|---|
| **Your contacts** | `list` `search` `get` `create` `update` `delete` |
| **Other contacts** — addresses you've corresponded with but never saved | `listOther` `searchOther` |
| **Your organization's directory** (Workspace accounts) | `listDirectory` `searchDirectory` |

The People API is awkward to call directly: a person's name is `names: [{givenName, familyName}]`, every read must declare a field mask or it's rejected outright, `sources` means two different things depending on the operation, and results come back under four different keys. None of that reaches the agent. `manage_contacts` takes flat values — `name`, `contactEmail`, `phone`, `company`, `jobTitle`, `notes` — and one list format comes back.

**Editing is precise.** `update` changes only the fields you pass. Omit a field and it's untouched; pass an empty string and it's cleared. Correcting a job title keeps the employer, the department, the phone number, and any second organization — the tool reads the current record and writes back only what you named.

### 🔐 Per-account read or read/write access

An account can now be authorized **read-only**:

```
manage_accounts { operation: 'scopes', email: 'you@example.com',
                  services: 'gmail,drive,contacts', access: 'read' }
```

Google is asked for the narrower scopes, so the token itself cannot send, edit or delete — not a rule this server enforces on top of a broad token. Where a service has no read-only scope, you're told which ones before the browser opens and nothing is authorized until you confirm.

`manage_accounts status` reports what each account actually holds.

### 📹 Meet: create and inspect meeting spaces

`createSpace`, `getSpace`, `updateSpace`, `endActiveConference`, and `activeConferences` — see what's live right now, not only what already finished.

### Also

- **`queue_operations` reaches every tool**, including newly added ones and itself. Its tool list was hand-written and had silently omitted anything added after it. Queues can now nest up to 3 deep, so a sub-queue can absorb its own failures without bailing the parent.
- **`descriptor.json` carries Google's enum values**, so a request body can be checked against what Google actually accepts instead of what looked right.
- Parameter descriptions the model never saw are now delivered — including the one warning that `calendar` `attendees` replaces the whole attendee list.

---

### ⚠️ Upgrading

Contacts needs **new OAuth scopes**, so existing accounts must re-consent:

```
manage_accounts { operation: 'scopes', email: 'you@example.com',
                  services: 'gmail,drive,calendar,sheets,docs,tasks,slides,meet,contacts' }
```

List every service you use — `scopes` grants what you name and nothing else.

You also need the **People API** enabled in your Google Cloud project (that's what Google calls Contacts in the console).

### On testing

Every operation in this release was run against live Google before shipping, on both personal and Workspace accounts. That found nine defects that passed linting, type-checking and a green test suite — among them an enum value that was right in the documentation and wrong on the wire, a response cap set above the client's actual ceiling, and two ways an update could destroy a field you hadn't mentioned while reporting success.
