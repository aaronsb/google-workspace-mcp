# v4.0.0

## ⚠️ Breaking: the licence changes from MIT to Apache-2.0

From this release the project is licensed under the [Apache License 2.0](LICENSE). Apache-2.0 adds an explicit patent grant and a requirement to state changes; it takes back nothing MIT permitted, so it is not a restriction on what you may do with the code. It is, however, a different licence, and if your organisation vets dependencies by licence it is a change worth knowing about — which is why this is a major version rather than a minor one.

The MIT history is preserved, not erased. Everything through v3.0.0 was MIT, and seven contributors besides the author hold copyright in that code. MIT permits sublicensing, so it redistributes cleanly under Apache-2.0 — its condition is that its notice travels with the code, and it does: `LICENSE-MIT` retains the original notice and `NOTICE` credits the contributors. Both the npm package and the `.mcpb` bundle carry all three files.

Related: `package.json` previously declared **no licence field at all**, so every version published to npm until now carried an unknown licence. It now declares `Apache-2.0`.

## Fixed: operations that reported success and did nothing

These were found by driving all eleven tools against a real Google account. None of them raised an error — every one returned "Operation completed."

- **`manage_tasks update` failed on every call.** It exposed no updatable fields, so the only request it could construct was a `PATCH` with an empty body — which Google Tasks answers with a `500 Internal error encountered`, an error that reads like an outage on Google's side and was not. This operation has never worked. It now takes `title`, `notes`, `due` and `status`, applies proper patch semantics (fields you don't pass are left alone), and an update naming no field is refused locally with a message saying which fields it takes.
- **`manage_tasks create` created blank, titleless tasks.** `title` was not in the tool's schema, so passing one dropped it in silence. It now takes `title`, `notes` and `due`.
- **`manage_tasks createTaskList` created nameless lists.** Same cause; it now takes `title`.
- **`manage_docs create` could only produce "Untitled document".** It now takes a `title`.
- **`manage_docs get` returned no document text**, despite being described as "get document content and metadata". Google nests a document's text several levels down and puts nothing readable at the top level, so every document came back looking empty. It now returns the text, including the contents of tables.
- **`manage_drive upload` could not upload a file from the workspace by name.** A relative path resolved against the server's working directory — wherever your MCP client happened to launch it — while `download`, `export` and email attachments all treat a relative path as workspace-relative. Relative paths are now workspace-relative everywhere. Absolute paths are unchanged.
- **Create operations now say what they created.** The generic confirmation only recognised an identifier literally named `id`; Google calls it `documentId` in Docs and `spreadsheetId` in Sheets, so creating a document returned, in full: "Operation completed." It now names the identifier and the title.

A new build check (`make check`) asserts that every write operation is *capable* of carrying a request body, so an operation cannot again ship structurally unable to do its job.

## Fixed: the coverage report contradicted the file it wrote

`make coverage` printed 60 of 233 methods covered while the baseline it wrote recorded 35, and nothing compared the two.

It inferred coverage from a proxy — an operation counted as covered only if it had a *parameter gap*. An operation with every parameter mapped has no gaps, so the best-covered operations were indistinguishable from uncovered ones and were persisted as gaps. Coverage was recorded as missing precisely where it was complete. Twenty-five already-implemented operations sat in `coverage-baseline.json` as uncovered work for contributors to pick up.

Coverage is now taken from the manifest directly, and the generator refuses to write a baseline that disagrees with its own report.

## Packaging: one bundle, not five

Releases used to ship five `.mcpb` bundles named for five platforms. With no platform-specific binary in the payload, all five were the same bytes under different names — the same 3,191 files under an identical content hash — and the platform in the filename promised a guarantee the build never made.

**Download `google-workspace-mcp.mcpb`.** One bundle runs everywhere: macOS (Intel and Apple Silicon), Linux (x64 and ARM64), and Windows. There is nothing to choose.

## Upgrading

No configuration changes. `GWS_SAFETY_POLICY` and the `gws://` resource URIs are unchanged. Node 22.12 or newer, as in v3.0.0.

If you install the `.mcpb` bundle, grab the single `google-workspace-mcp.mcpb` asset rather than a platform-specific one.
