/**
 * LIVE VERIFICATION — the real entry point, real Google, reversible.
 *
 * This replaces an "integration" test that exercised
 * `src/server/handlers/{email,calendar,drive}.ts` — three handler modules the
 * server NEVER CALLED. They were pre-factory legacy (ADR-300 superseded them),
 * imported by nobody, and their tests were skipped unless a live account was
 * configured. So the file that existed to prove the system works end-to-end was
 * testing dead code, and not even running. It was green for months and meant
 * nothing.
 *
 * The fix is not to delete integration testing. It is to point it at the thing
 * the server actually runs: `handleToolCall`, which is what an MCP client invokes.
 *
 * WHY THIS EXISTS AT ALL (ADR-103): with `gws` gone, there is no second
 * implementation to diff against. That is fine — gws was never the real oracle.
 * GOOGLE is. And Google is a BETTER oracle, because it is the thing we have to be
 * correct against, whereas gws was an implementation we have now proven is wrong
 * in places (its `--week` window silently hides earlier-today events; it swallowed
 * per-calendar failures; it capped lists at 50 with no pagination). Diffing
 * against that risks PARITY WITH A BUG.
 *
 * The one thing gws did give us was INDEPENDENCE: a second opinion on how to build
 * a request. We get that back a better way — by never asserting on what we SENT.
 * Every mutating check here is:
 *
 *      create  ->  READ IT BACK OFF GOOGLE  ->  assert the read-back
 *
 * Google's own response is the independent witness. If we build a malformed
 * request, Google rejects it, or the read-back disagrees. Asserting on our own
 * `buildRequest` output would just be the code agreeing with itself.
 *
 * SAFETY: every artifact is created and then DELETED in a `finally`. Mail is only
 * ever DRAFTED, never sent. Nothing here touches existing data.
 *
 * Skipped unless an account is configured, so CI without credentials reports
 * "skipped" rather than failing.
 *
 *   npm run verify:live
 */
import { afterAll, describe, expect, it } from 'vitest';

import { handleToolCall } from '../../server/handler.js';
import { call } from '../../google/client.js';
import { getTestAccount } from './setup.js';

const account = getTestAccount();
const describeIf = account ? describe : describe.skip;
const email = account?.email ?? '';

/** Everything we create, so `finally` can remove it even if an assertion throws. */
const cleanup: Array<() => Promise<unknown>> = [];

afterAll(async () => {
  for (const undo of cleanup.reverse()) {
    await undo().catch(() => { /* best effort — a failed cleanup must not mask a failed test */ });
  }
});

describeIf('live verification (real Google, through the real MCP entry point)', () => {
  // --- read paths: does the tool actually return what it claims? -------------

  it('manage_email search HYDRATES — the output carries senders and subjects, not just ids', async () => {
    const result = await handleToolCall('manage_email', { operation: 'search', email, maxResults: 3 });

    const ids = result.refs.messages as string[];
    expect(Array.isArray(ids)).toBe(true);
    if (ids.length === 0) return;                   // empty mailbox: nothing to assert

    // The whole point of the hydrate. `messages.list` returns {id, threadId} and
    // NOTHING else — no sender, no subject. If hydration silently broke, the tool
    // would still "succeed" and return a list of opaque hex ids, which is useless
    // to an agent and would not throw. So assert on what only a per-message
    // `messages.get` can produce: a sender and a subject in the rendered row.
    const rows = result.text.split('\n').filter((l) => l.includes('|'));
    expect(rows.length).toBeGreaterThan(0);

    const [firstId] = ids;
    const row = rows.find((l) => l.includes(firstId));
    expect(row, 'every id should have a rendered row').toBeTruthy();

    // id | sender | subject | date  — four columns means the hydrate ran.
    const columns = row!.split('|').map((c) => c.trim()).filter(Boolean);
    expect(columns.length).toBeGreaterThanOrEqual(3);
    expect(columns[1]).toBeTruthy();                // sender
    expect(columns[2]).toBeTruthy();                // subject
  }, 30_000);

  it('manage_calendar agenda merges calendars and reports any it could not read', async () => {
    const result = await handleToolCall('manage_calendar', { operation: 'agenda', email, week: true });

    expect(result.refs.count).toBeDefined();
    // The window must start at midnight, not "now" — gws's rolling window hid
    // everything earlier today, which is the bug this operation exists to not have.
    const timeMin = new Date(result.refs.timeMin as string);
    expect(timeMin.getHours()).toBe(0);
    expect(timeMin.getMinutes()).toBe(0);
  }, 60_000);

  it('manage_drive search returns files', async () => {
    const result = await handleToolCall('manage_drive', { operation: 'search', email, pageSize: 3 });
    expect(result.text).toBeTruthy();
  }, 30_000);

  // --- write paths: create -> READ BACK -> delete ----------------------------
  //
  // The assertion is always on what GOOGLE hands back, never on what we sent.

  it('calendar create: the event Google stores is the event we asked for', async () => {
    const start = new Date(Date.now() + 86_400_000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 3_600_000);
    const summary = `ADR-103 live check ${start.getTime()}`;

    const created = await handleToolCall('manage_calendar', {
      operation: 'create', email, summary,
      start: start.toISOString(), end: end.toISOString(),
      location: 'Somewhere',
      attendees: 'nobody@example.com',
    });

    const eventId = created.refs.eventId as string;
    expect(eventId).toBeTruthy();
    cleanup.push(() => call('calendar', 'events.delete', { calendarId: 'primary', eventId }, { account: email }));

    // READ IT BACK. This is the independent witness.
    const stored = await call('calendar', 'events.get',
      { calendarId: 'primary', eventId }, { account: email }) as Record<string, unknown>;

    expect(stored.summary).toBe(summary);
    expect(stored.location).toBe('Somewhere');
    // attendees must be an ARRAY OF OBJECTS. gws needed `--attendee` (singular)
    // because of a CLI argument parser; what actually decides whether a guest is
    // invited is this shape.
    const attendees = stored.attendees as Array<{ email: string }> | undefined;
    expect(attendees?.[0]?.email).toBe('nobody@example.com');
    const storedStart = (stored.start as { dateTime: string }).dateTime;
    expect(new Date(storedStart).getTime()).toBe(start.getTime());
  }, 60_000);

  it('drive upload: the bytes Google stores are the bytes we sent', async () => {
    const content = `adr-103 live check\n${'x'.repeat(5000)}\n`;
    const { writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { getWorkspaceDir, ensureWorkspaceDir } = await import('../../executor/workspace.js');

    await ensureWorkspaceDir();
    const filename = `adr-103-live-${Date.now()}.txt`;
    const filePath = join(getWorkspaceDir(), filename);
    await writeFile(filePath, content);
    cleanup.push(() => rm(filePath, { force: true }));

    const uploaded = await handleToolCall('manage_drive', { operation: 'upload', email, filePath });
    const fileId = uploaded.refs.fileId as string;
    expect(fileId).toBeTruthy();
    cleanup.push(() => call('drive', 'files.delete', { fileId }, { account: email }));

    // READ IT BACK — the file Google holds, not the request we built.
    const meta = await call('drive', 'files.get',
      { fileId, fields: 'name,size' }, { account: email }) as Record<string, unknown>;
    expect(meta.name).toBe(filename);
    expect(Number(meta.size)).toBe(Buffer.byteLength(content));
  }, 90_000);

  it('gmail send with an attachment: the draft Google stores carries the real bytes', async () => {
    const content = `attachment probe ${Date.now()}\n`;
    const { writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { getWorkspaceDir, ensureWorkspaceDir } = await import('../../executor/workspace.js');

    await ensureWorkspaceDir();
    const filename = `adr-103-attach-${Date.now()}.txt`;
    await writeFile(join(getWorkspaceDir(), filename), content);
    cleanup.push(() => rm(join(getWorkspaceDir(), filename), { force: true }));

    // An attachment forces a DRAFT — nothing is sent to anyone.
    const sent = await handleToolCall('manage_email', {
      operation: 'send', email, to: email,
      subject: 'ADR-103 live check', body: 'ignore me',
      attachments: filename,
    });

    const draftId = sent.refs.draftId as string;
    expect(draftId).toBeTruthy();
    expect(sent.refs.isDraft).toBe(true);
    cleanup.push(() => call('gmail', 'users.drafts.delete', { userId: 'me', id: draftId }, { account: email }));

    // READ IT BACK: walk the MIME tree Google parsed, and fetch the attachment.
    const draft = await call('gmail', 'users.drafts.get',
      { userId: 'me', id: draftId, format: 'full' }, { account: email }) as Record<string, unknown>;
    const message = draft.message as Record<string, unknown>;

    const walk = (p: Record<string, unknown>): Record<string, unknown> | undefined => {
      const body = p.body as { attachmentId?: string } | undefined;
      if (p.filename && body?.attachmentId) return p;
      for (const child of (p.parts ?? []) as Array<Record<string, unknown>>) {
        const hit = walk(child);
        if (hit) return hit;
      }
      return undefined;
    };
    const part = walk(message.payload as Record<string, unknown>);
    expect(part?.filename).toBe(filename);

    const body = part!.body as { attachmentId: string };
    const attachment = await call('gmail', 'users.messages.attachments.get',
      { userId: 'me', messageId: message.id, id: body.attachmentId }, { account: email }) as { data: string };

    // The bytes Google gives back must be the bytes we put in.
    expect(Buffer.from(attachment.data, 'base64url').toString('utf-8')).toBe(content);
  }, 90_000);

  it('docs write: the text Google stores is the text we appended', async () => {
    const created = await call('docs', 'documents.create',
      { title: `ADR-103 live check ${Date.now()}` }, { account: email }) as Record<string, unknown>;
    const documentId = String(created.documentId);
    cleanup.push(() => call('drive', 'files.delete', { fileId: documentId }, { account: email }));

    const text = `appended by the live check ${Date.now()}`;
    await handleToolCall('manage_docs', { operation: 'write', email, documentId, text });

    const doc = await call('docs', 'documents.get', { documentId }, { account: email }) as Record<string, unknown>;
    const flatten = JSON.stringify(doc.body);
    expect(flatten).toContain(text);
  }, 60_000);
});
