// Mock registry before tools imports it — avoids import.meta.url in Jest
jest.mock('../../factory/registry.js', () => {
  const { loadManifest, generateTools } = jest.requireActual('../../factory/generator.js');
  const { patches } = jest.requireActual('../../factory/patches.js');
  const manifest = loadManifest();
  return { manifest, generatedTools: generateTools(manifest, patches) };
});

import { toolSchemas, getToolSchema } from '../../server/tools.js';

describe('tool registry', () => {
  it('has all expected tools', () => {
    const names = toolSchemas.map(t => t.name);
    // Hand-coded tools
    expect(names).toContain('manage_accounts');
    expect(names).toContain('queue_operations');
    // Factory-generated tools
    expect(names).toContain('manage_email');
    expect(names).toContain('manage_calendar');
    expect(names).toContain('manage_drive');
    expect(names).toContain('manage_sheets');
    expect(names).toContain('manage_docs');
    expect(names).toContain('manage_tasks');
    expect(names).toContain('manage_contacts');
    expect(names).toContain('manage_meet');
    expect(names.length).toBeGreaterThanOrEqual(10);
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
    // Core operations present (manifest may expand)
    expect(props.operation.enum).toContain('search');
    expect(props.operation.enum).toContain('read');
    expect(props.operation.enum).toContain('send');
    expect(props.operation.enum).toContain('reply');
    expect(props.operation.enum).toContain('triage');
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
    // Core operations present (manifest may expand)
    expect(props.operation.enum).toContain('list');
    expect(props.operation.enum).toContain('agenda');
    expect(props.operation.enum).toContain('create');
    expect(props.operation.enum).toContain('get');
    expect(props.operation.enum).toContain('delete');
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
