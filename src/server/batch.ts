/**
 * Batch mode for `bulk_operations` — one Google request across many resources. ADR-308.
 *
 * The rule that makes one shape serve five different Google methods: **top-level
 * arguments are shared across the batch, `items` carry what differs**. A batch is one
 * call with one set of parameters applied to many resources, so a parameter that varies
 * per item is not a batch — it is a queue.
 *
 * Which operations can batch is DERIVED from the manifest's `batch:` blocks. Nothing here
 * lists them. This repository has produced the hand-maintained-list-beside-a-generated-one
 * defect three times (the hardcoded queue tool enum, the stale coverage baseline, #161),
 * and a list of batchable operations would be the fourth.
 */
import { loadManifest } from '../factory/generator.js';
import { evaluatePolicies } from '../factory/safety.js';
import { call } from '../google/client.js';
import { buildPerson } from '../services/contacts/patch.js';
import type { GoogleService, ServiceMethods } from '../google/methods.js';
import type { HandlerResponse } from './formatting/markdown.js';

/** One batchable operation, as the manifest declares it. */
export interface BatchableOp {
  tool: string;
  operation: string;
  service: string;
  googleService: string;
  resource: string;
  defaults: Record<string, unknown>;
  type: 'list' | 'detail' | 'action';
}

/** Every operation the manifest says can batch, keyed `tool.operation`. */
export function batchableOperations(): Map<string, BatchableOp> {
  const out = new Map<string, BatchableOp>();
  for (const [service, def] of Object.entries(loadManifest().services)) {
    for (const [operation, op] of Object.entries(def.operations)) {
      if (!op.batch) continue;
      out.set(`${def.tool_name}.${operation}`, {
        tool: def.tool_name,
        operation,
        service,
        googleService: def.google_service,
        resource: op.batch.resource,
        defaults: op.batch.defaults ?? {},
        type: op.type,
      });
    }
  }
  return out;
}

/** `manage_email modify, manage_contacts create, …` — for telling a caller what does batch. */
function batchableList(): string {
  return [...batchableOperations().values()]
    .map((b) => `${b.tool} ${b.operation}`)
    .join(', ');
}

/**
 * Turn the shared arguments and the per-item arguments into the body Google wants.
 *
 * Keyed by the Google method rather than by our operation name, because the body shape is
 * Google's, and two of our operations (`modify` and `trash`) share one method.
 *
 * Every builder here was written against Google's declared request shape. None of them is
 * verified live yet — see the note on limits at the end of ADR-308.
 */
type BodyBuilder = (shared: Record<string, unknown>, items: Record<string, unknown>[]) => Record<string, unknown>;

/**
 * The one field an item is mostly likely to be, per method — so a caller with a list of
 * ids can pass a list of ids.
 *
 * `items: ['people/c1', 'people/c2']` says everything `items: [{contactId:'people/c1'},
 * {contactId:'people/c2'}]` says, with less to get wrong. The object form still works for
 * the operations that carry more than an id.
 */
const ITEM_ID_FIELD: Record<string, string> = {
  'users.messages.batchModify': 'messageId',
  'people.batchDeleteContacts': 'contactId',
  'people.getBatchGet': 'contactId',
  'people.batchUpdateContacts': 'contactId',
};

/**
 * Accept a bare id where an object is expected, and a bare contact id where Google wants
 * the `people/` prefix — the same courtesy the single-contact operations extend.
 */
function normalizeItems(items: unknown[], resource: string): Record<string, unknown>[] {
  const field = ITEM_ID_FIELD[resource];
  return items.map((item) => {
    const obj = (typeof item === 'string' && field)
      ? { [field]: item }
      : (item as Record<string, unknown>);

    const id = obj?.contactId ?? obj?.resourceName;
    if (typeof id === 'string' && id && !id.startsWith('people/')) {
      return { ...obj, contactId: `people/${id}` };
    }
    return obj;
  });
}

const BODY_BUILDERS: Record<string, BodyBuilder> = {
  // ids + the label changes, which are shared by definition: one call sets one label set.
  'users.messages.batchModify': (shared, items) => ({
    ids: items.map((i) => str(i.messageId)),
    ...(shared.addLabelIds ? { addLabelIds: list(shared.addLabelIds) } : {}),
    ...(shared.removeLabelIds ? { removeLabelIds: list(shared.removeLabelIds) } : {}),
  }),

  // Each contact is different, so the whole payload comes from items. `buildPerson` is
  // the same converter single `create` uses, so a batch item takes the same flat fields —
  // name, contactEmail, phone. Passing them raw is a 400 from Google, measured; the raw
  // People shape is still accepted via `person` for anything the flat fields cannot say.
  'people.batchCreateContacts': (shared, items) => ({
    contacts: items.map((i) => ({ contactPerson: i.person ?? buildPerson(i).person })),
    readMask: shared.readMask ?? 'names,emailAddresses,phoneNumbers,organizations,metadata',
  }),

  'people.batchDeleteContacts': (_shared, items) => ({
    resourceNames: items.map((i) => str(i.contactId ?? i.resourceName)),
  }),

  // A map keyed by resource name rather than an array — Google's shape, not ours. Each
  // person must carry its current etag, which `prepare` below fetches; without it Google
  // answers FAILED_PRECONDITION (measured).
  'people.batchUpdateContacts': (shared, items) => {
    const touched = new Set<string>();
    const contacts: Record<string, unknown> = {};
    for (const i of items) {
      const built = i.person ? { person: i.person as Record<string, unknown>, touched: new Set<string>() } : buildPerson(i);
      for (const f of built.touched) touched.add(f);
      contacts[str(i.contactId ?? i.resourceName)] = { ...built.person, etag: i.etag };
    }
    return {
      contacts,
      // Derived from the fields the caller actually supplied, exactly as single `update`
      // does. A fixed mask would name fields nobody touched, and naming a field with no
      // value in the body CLEARS it.
      updateMask: shared.updateMask ?? [...touched].join(','),
      readMask: shared.readMask ?? 'names,emailAddresses,phoneNumbers,organizations,metadata',
    };
  },

  // A GET: resourceNames is a repeated QUERY parameter, not a body.
  'people.getBatchGet': (shared, items) => ({
    resourceNames: items.map((i) => str(i.contactId ?? i.resourceName)),
    personFields: shared.personFields ?? 'names,emailAddresses,phoneNumbers,organizations,metadata',
  }),
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

/** Accept `'A,B'` or `['A','B']` — Google always wants the array. */
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str);
  return str(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Work some methods need before the batch call itself.
 *
 * `batchUpdateContacts` requires each person's current etag — Google answers
 * FAILED_PRECONDITION without one (measured). Fetching them is one `getBatchGet`, so a
 * batch update costs two calls for N contacts rather than the 2N a queue would.
 */
const PREPARE: Record<string, (items: Record<string, unknown>[], account: string) => Promise<Record<string, unknown>[]>> = {
  'people.batchUpdateContacts': async (items, account) => {
    const names = items.map((i) => str(i.contactId ?? i.resourceName));
    const got = await call('people', 'people.getBatchGet', {
      resourceNames: names,
      personFields: 'names,emailAddresses,phoneNumbers,organizations,biographies,metadata',
    }, { account }) as Record<string, unknown>;

    const etags = new Map<string, unknown>();
    for (const r of (got.responses as Record<string, unknown>[] | undefined) ?? []) {
      const person = r.person as Record<string, unknown> | undefined;
      if (person?.resourceName) etags.set(str(person.resourceName), person.etag);
    }

    return items.map((i) => {
      const name = str(i.contactId ?? i.resourceName);
      const etag = etags.get(name);
      if (etag === undefined) throw new Error(`No contact found for ${name} — cannot update what does not exist.`);
      return { ...i, contactId: name, etag };
    });
  },
};

/** A person as one line, matching how the single-contact operations print. */
function personLine(person: Record<string, unknown>): string {
  const names = (person.names as Record<string, unknown>[] | undefined) ?? [];
  const display = names[0]?.displayName ?? [names[0]?.givenName, names[0]?.familyName].filter(Boolean).join(' ');
  const emails = (person.emailAddresses as Record<string, unknown>[] | undefined) ?? [];
  const parts = [str(person.resourceName), str(display || '(no name)')];
  if (emails[0]?.value) parts.push(str(emails[0].value));
  return parts.join(' | ');
}

/**
 * Render what came back, so a batch READ is worth making.
 *
 * `refs` never reaches the model — the server returns `result.text` only — so anything
 * the agent must act on has to be in the text. Live, `get` answered "2 results returned"
 * and threw the two people away.
 */
function renderPeople(data: Record<string, unknown>): string | null {
  const rows: string[] = [];
  for (const r of (data.responses as Record<string, unknown>[] | undefined) ?? []) {
    if (r.person) rows.push(personLine(r.person as Record<string, unknown>));
  }
  for (const r of (data.createdPeople as Record<string, unknown>[] | undefined) ?? []) {
    if (r.person) rows.push(personLine(r.person as Record<string, unknown>));
  }
  const updated = data.updateResult as Record<string, Record<string, unknown>> | undefined;
  for (const r of Object.values(updated ?? {})) {
    if (r.person) rows.push(personLine(r.person as Record<string, unknown>));
  }
  return rows.length ? rows.join('\n') : null;
}

/**
 * Run one batch call.
 *
 * Refusing is as important as running: an operation with no `batch:` block cannot be
 * batched, and saying so with the list of what can turns a dead end into the answer.
 */
export async function handleBatch(params: Record<string, unknown>): Promise<HandlerResponse> {
  const tool = params.tool as string | undefined;
  const operation = params.operation as string | undefined;
  const rawItems = params.items as unknown[] | undefined;

  if (!tool || !operation) {
    return err(`mode:'batch' needs \`tool\` and \`operation\`. Operations that batch: ${batchableList()}.`);
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return err(`mode:'batch' needs a non-empty \`items\` array — one entry per resource to act on.`);
  }

  const batchable = batchableOperations();
  const spec = batchable.get(`${tool}.${operation}`);
  if (!spec) {
    // Deliberately does not claim "Google publishes no batch method". For docs and
    // sheets that is false — they publish `batchUpdate`, which batches many edits to ONE
    // document rather than one edit across many. Saying otherwise would teach the caller
    // something untrue about Google's API.
    return err(
      `${tool} '${operation}' cannot be batched. ` +
      `Operations that can: ${batchableList()}. ` +
      `Use mode:'queue' instead, which works for every operation.`,
    );
  }

  const items = normalizeItems(rawItems, spec.resource);

  const build = BODY_BUILDERS[spec.resource];
  if (!build) {
    // A manifest declared a batch resource this file cannot build a body for. That is a
    // bug in this repo, not in the caller's request, so it says so plainly.
    return err(`${tool} '${operation}' declares batch resource ${spec.resource}, which has no body builder.`);
  }

  const account = params.email as string | undefined;
  if (!account) return err(`mode:'batch' needs \`email\` — the account to act as.`);

  // Batch reaches Google without passing through generateHandler, so it gets no policy
  // check for free — the same way manage_scratchpad did not (#171). Doing many writes at
  // once is the last place to skip this: a read-only account would otherwise be refused
  // one contact deletion and permitted two hundred.
  const decision = await evaluatePolicies([], { operation: spec.operation, params, account }, spec.googleService, {
    service: spec.service,
    googleService: spec.googleService,
    resource: spec.resource,
    type: spec.type,
  });
  if (decision.action === 'block') {
    return {
      text: `**Blocked by safety policy:** ${decision.reason}`,
      refs: { blocked: true, error: true, policy: decision.reason },
    };
  }

  // Shared arguments are everything the caller passed that is not batch plumbing.
  const { mode: _m, tool: _t, operation: _o, items: _i, email: _e, detail: _d, ...shared } = params;

  let prepared = items;
  const prepare = PREPARE[spec.resource];
  if (prepare) {
    try {
      prepared = await prepare(items, account);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  }

  const body = { ...spec.defaults, ...build({ ...spec.defaults, ...shared }, prepared) };

  const data = await call(
    spec.googleService as GoogleService,
    spec.resource as ServiceMethods[GoogleService],
    body,
    { account },
  );

  const rendered = renderPeople((data ?? {}) as Record<string, unknown>);
  return {
    text:
      `## Batch: ${tool} ${operation}\n\n` +
      `${items.length} item${items.length === 1 ? '' : 's'} in one request ` +
      `(\`${spec.resource}\`).\n\n${rendered ?? summarize(data)}`,
    refs: { batch: true, tool, operation, resource: spec.resource, count: items.length, data },
  };
}

/**
 * Say what Google said, without inventing per-item detail it did not send.
 *
 * The methods differ here and the difference is not ours to paper over: batchModify and
 * batchDelete answer 204 with no body, so a partial failure is not distinguishable per
 * item; batchCreateContacts answers with a result per contact. Presenting one uniform
 * shape would mean fabricating the missing half.
 */
function summarize(data: unknown): string {
  if (data === undefined || data === null || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return 'Google accepted the request and returned no body, which is how it reports success for this method. It does not report per-item status.';
  }
  const rec = data as Record<string, unknown>;
  for (const key of ['createContacts', 'updateResult', 'responses']) {
    const arr = rec[key];
    if (Array.isArray(arr)) return `${arr.length} result${arr.length === 1 ? '' : 's'} returned.`;
  }
  if (rec.responses || rec.createContacts || rec.updateResult) return 'Completed.';
  return 'Completed.';
}

function err(text: string): HandlerResponse {
  return { text, refs: { error: true } };
}
