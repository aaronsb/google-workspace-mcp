/**
 * Label changes, in words. Shared by the two previews that describe a label change before
 * it happens: a filter's (on each message as it arrives) and a query-scoped bulk change's
 * (on every message the preview counted). ADR-309, ADR-310.
 */

import { call } from '../../google/client.js';

export interface Effect {
  /** What happens, in a clause: "skips the inbox". */
  text: string;
  /** Why it is worth a second look, shown in full previews only. */
  detail?: string;
  /** A consequence worth a second look before approving: disposal, or mail leaving the account. */
  warn?: boolean;
}

export interface LabelChange {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

/** When the change lands: as each future match arrives, or now on the set already there. */
export type Timing = 'arrival' | 'now';

type Phrased = Record<Timing, Effect>;

const TRASH_DETAIL = 'Gmail deletes trash permanently after 30 days';
const SPAM_DETAIL = 'Gmail deletes spam permanently after 30 days';

/** System labels a label change cannot add or remove; Gmail refuses them. */
const UNCHANGEABLE = new Set(['SENT', 'DRAFT', 'CHAT']);

const SYSTEM_LABEL_EFFECTS: Record<string, { add?: Phrased; remove?: Phrased }> = {
  INBOX: {
    add: { arrival: { text: 'kept in the inbox' }, now: { text: 'put in the inbox' } },
    remove: { arrival: { text: 'skips the inbox: archived on arrival' }, now: { text: 'archived: removed from the inbox' } },
  },
  UNREAD: {
    add: { arrival: { text: 'marked unread' }, now: { text: 'marked unread' } },
    remove: { arrival: { text: 'marked read on arrival' }, now: { text: 'marked read' } },
  },
  STARRED: {
    add: { arrival: { text: 'starred' }, now: { text: 'starred' } },
    remove: { arrival: { text: 'never starred' }, now: { text: 'unstarred' } },
  },
  IMPORTANT: {
    add: { arrival: { text: 'marked important' }, now: { text: 'marked important' } },
    remove: { arrival: { text: 'never marked important' }, now: { text: 'marked not important' } },
  },
  TRASH: {
    add: {
      arrival: { text: 'moved to trash on arrival', detail: `${TRASH_DETAIL}, so matching mail nobody looks at is gone after that`, warn: true },
      now: {
        text: 'moved to trash',
        detail: `This is a bulk trash. ${TRASH_DETAIL}; until then, preview the same query with \`in:trash\` added and removeLabelIds TRASH to restore them`,
        warn: true,
      },
    },
    remove: { arrival: { text: 'kept out of trash' }, now: { text: 'restored from trash' } },
  },
  SPAM: {
    add: {
      arrival: { text: 'sent to spam on arrival', detail: SPAM_DETAIL, warn: true },
      now: { text: 'moved to spam', detail: SPAM_DETAIL, warn: true },
    },
    remove: { arrival: { text: 'never sent to spam' }, now: { text: 'taken out of spam' } },
  },
};

/** Comma-separated (or array) label ids, trimmed, deduplicated and sorted; undefined when none. */
export function parseLabelIds(value: unknown): string[] | undefined {
  const items = Array.isArray(value) ? value.map(String) : String(value ?? '').split(',');
  const ids = [...new Set(items.map((s) => s.trim()).filter(Boolean))].sort();
  return ids.length ? ids : undefined;
}

/** Label id → name, for every label on the account, system labels included. */
export async function labelNames(account: string): Promise<Map<string, string>> {
  const raw = await call('gmail', 'users.labels.list', { userId: 'me' }, { account }) as Record<string, unknown>;
  const labels = (raw?.labels ?? []) as Array<{ id?: string; name?: string }>;
  return new Map(labels.filter((l) => l.id).map((l) => [String(l.id), String(l.name ?? l.id)]));
}

/**
 * One error per label id the account does not have. A label NAME passed where an id
 * belongs is the common mistake, so it is answered with the id.
 */
export function labelIdErrors(change: LabelChange, names: Map<string, string>): string[] {
  const byName = new Map([...names].map(([id, n]) => [n.toLowerCase(), id]));
  const errors: string[] = [];
  for (const id of [...(change.addLabelIds ?? []), ...(change.removeLabelIds ?? [])]) {
    if (UNCHANGEABLE.has(id)) {
      errors.push(`${id} is set by Gmail itself; a label change cannot add or remove it.`);
      continue;
    }
    if (names.has(id)) continue;
    const hint = byName.get(id.toLowerCase());
    errors.push(hint
      ? `'${id}' is a label name; this takes its id, ${hint}.`
      : `No label with id '${id}' on this account. Create it with \`createLabel\`, or see ids with \`labels\`.`);
  }
  return errors;
}

export function describeLabelChanges(change: LabelChange, names: Map<string, string>, timing: Timing): Effect[] {
  const effects: Effect[] = [];
  const name = (id: string) => names.get(id) ?? id;
  const category = (id: string) => id.slice('CATEGORY_'.length).toLowerCase();
  for (const id of change.addLabelIds ?? []) {
    const system = SYSTEM_LABEL_EFFECTS[id]?.add?.[timing];
    if (system) effects.push(system);
    else if (id.startsWith('CATEGORY_')) effects.push({ text: `sorted into the ${category(id)} category` });
    else effects.push({ text: `labeled "${name(id)}"` });
  }
  for (const id of change.removeLabelIds ?? []) {
    const system = SYSTEM_LABEL_EFFECTS[id]?.remove?.[timing];
    if (system) effects.push(system);
    else if (id.startsWith('CATEGORY_')) effects.push({ text: `${timing === 'arrival' ? 'kept out of' : 'taken out of'} the ${category(id)} category` });
    else effects.push({ text: `"${name(id)}" label removed` });
  }
  return effects;
}

/** A bullet for a preview: the warning mark, the effect, and its detail. */
export function effectLine(e: Effect): string {
  return `- ${e.warn ? '⚠ ' : ''}${e.text}${e.detail ? `. ${e.detail}` : ''}`;
}
