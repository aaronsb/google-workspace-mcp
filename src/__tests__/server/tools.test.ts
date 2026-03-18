import { toolSchemas, getToolSchema } from '../../server/tools.js';

describe('tool registry', () => {
  it('has 5 operation-based tools', () => {
    const names = toolSchemas.map(t => t.name);
    expect(names).toEqual([
      'manage_accounts',
      'queue_operations',
      'manage_email',
      'manage_calendar',
      'manage_drive',
    ]);
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

  it('all domain tools require operation', () => {
    const domainTools = toolSchemas.filter(t => t.name !== 'queue_operations');
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
    expect(props.operation.enum).toEqual(['search', 'read', 'send', 'reply', 'triage', 'forward', 'trash', 'untrash', 'labels']);
  });

  it('requires email', () => {
    const required = (tool.inputSchema as any).required;
    expect(required).toContain('email');
  });
});

describe('manage_calendar schema', () => {
  const tool = getToolSchema('manage_calendar')!;
  const props = (tool.inputSchema as any).properties;

  it('has operation enum with calendar operations', () => {
    expect(props.operation.enum).toEqual(['list', 'agenda', 'create', 'get', 'delete', 'quickAdd', 'update']);
  });
});

describe('queue_operations schema', () => {
  const tool = getToolSchema('queue_operations')!;
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
