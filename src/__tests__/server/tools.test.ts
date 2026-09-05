import { describe, expect, it, vi, type Mock } from 'vitest';

import { toolSchemas, getToolSchema } from '../../server/tools.js';
import { BULK_TOOL_NAMES } from '../../server/handler.js';

describe('tool registry', () => {
  it('has all expected tools', () => {
    const names = toolSchemas.map(t => t.name);
    // Hand-coded tools
    expect(names).toContain('manage_accounts');
    expect(names).toContain('bulk_operations');
    expect(names).toContain('queue_operations');  // the alias, ADR-308
    // Factory-generated tools
    expect(names).toContain('manage_email');
    expect(names).toContain('manage_calendar');
    expect(names).toContain('manage_drive');
    expect(names).toContain('manage_sheets');
    expect(names).toContain('manage_docs');
    expect(names).toContain('manage_tasks');
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  it('getToolSchema returns correct tool', () => {
    const tool = getToolSchema('manage_email');
    expect(tool?.name).toBe('manage_email');
  });

  it('getToolSchema returns undefined for unknown', () => {
    expect(getToolSchema('nonexistent')).toBeUndefined();
  });

  it('all schemas have additionalProperties: false', () => {
    for (const tool of toolSchemas) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('bulk_operations can reach every tool the server advertises', () => {
    // This enum used to be written out by hand, so it silently omitted every tool added
    // after it. A new tool worked on its own and was unreachable from a queue, with
    // nothing anywhere to say why — the handler side never had the problem, because
    // domainHandlers is built from the registry. manage_contacts is what surfaced it.
    const bulk = getToolSchema('bulk_operations')!;
    const offered = (bulk.inputSchema as any).properties.operations.items.properties.tool.enum as string[];

    // Every tool, with no carve-out — including bulk_operations itself and the alias.
    // Nesting is bounded by depth in handleQueue, not by hiding the tool here.
    expect([...offered].sort()).toEqual([...toolSchemas.map(t => t.name)].sort());
    expect(offered).toContain('manage_contacts');
    expect(offered).toContain('bulk_operations');
    expect(offered).toContain('queue_operations');
  });

  it('all domain tools require operation', () => {
    // Derived, not listed: the bulk tool and its alias are the only tools with no
    // `operation`, and hardcoding that exclusion is how the rename broke this test.
    const domainTools = toolSchemas.filter(t => !BULK_TOOL_NAMES.includes(t.name));
    for (const tool of domainTools) {
      const required = (tool.inputSchema as Record<string, unknown>).required as string[];
      expect(required).toContain('operation');
    }
  });
});

describe('manage_email schema', () => {
  const tool = getToolSchema('manage_email')!;
  const props = (tool.inputSchema as any).properties;

  it('has operation enum with all email operations', () => {
    // Core operations present (manifest may expand)
    expect(props.operation.enum).toContain('search');
    expect(props.operation.enum).toContain('read');
    expect(props.operation.enum).toContain('send');
    expect(props.operation.enum).toContain('reply');
    expect(props.operation.enum).toContain('triage');
    expect(props.operation.enum).toContain('listDrafts');
    expect(props.operation.enum).toContain('deleteDraft');
  });

  it('exposes draftId (the id deleteDraft needs) and nothing named after a message id', () => {
    expect(props.draftId).toMatchObject({ type: 'string' });
    expect(props.draftId.description).toContain('Draft id');
    expect(props.draftId.description).toContain('listDrafts');
  });

  it('requires email', () => {
    const required = (tool.inputSchema as any).required;
    expect(required).toContain('email');
  });

  it('exposes from for Gmail send aliases', () => {
    expect(props.from).toMatchObject({
      type: 'string',
    });
    expect(props.from.description).toContain('Send As alias');
  });
});

describe('manage_calendar schema', () => {
  const tool = getToolSchema('manage_calendar')!;
  const props = (tool.inputSchema as any).properties;

  it('has operation enum with calendar operations', () => {
    // Core operations present (manifest may expand)
    expect(props.operation.enum).toContain('list');
    expect(props.operation.enum).toContain('agenda');
    expect(props.operation.enum).toContain('create');
    expect(props.operation.enum).toContain('get');
    expect(props.operation.enum).toContain('delete');
  });
});

describe('bulk_operations schema', () => {
  const tool = getToolSchema('bulk_operations')!;
  const props = (tool.inputSchema as any).properties;

  it('has operations array with maxItems', () => {
    expect(props.operations.type).toBe('array');
    expect(props.operations.maxItems).toBe(10);
  });

  it('operations items require tool and args', () => {
    expect(props.operations.items.required).toEqual(['tool', 'args']);
  });

  it('tool enum includes all domain tools', () => {
    const toolEnum = props.operations.items.properties.tool.enum;
    expect(toolEnum).toContain('manage_email');
    expect(toolEnum).toContain('manage_calendar');
    expect(toolEnum).toContain('manage_drive');
    expect(toolEnum).toContain('manage_accounts');
  });
});

describe('the queue_operations alias', () => {
  // ADR-308. Removing the old name outright would answer an established call with
  // "Unknown tool" and no hint of what replaced it — MCP client configs and agent habits
  // both name it. Remove after one minor release.
  it('is still advertised', () => {
    expect(getToolSchema('queue_operations')).toBeDefined();
  });

  it('says it was renamed, so a reader learns the new name from the tool list', () => {
    const alias = getToolSchema('queue_operations')!;
    expect(alias.description).toContain('RENAMED');
    expect(alias.description).toContain('bulk_operations');
  });

  it('shares one schema object with bulk_operations, so the two cannot drift', () => {
    // Identity, not equality. Two structurally equal copies would drift the moment
    // either is edited — and the derived tool enum is written into one of them.
    expect(getToolSchema('queue_operations')!.inputSchema)
      .toBe(getToolSchema('bulk_operations')!.inputSchema);
  });
});
