import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  configurePolicies,
  evaluatePolicies,
  draftOnlyEmail,
  noDelete,
  readOnly,
  auditLog,
} from '../../factory/safety.js';
import type { PatchContext } from '../../factory/types.js';

function ctx(operation: string): PatchContext {
  return { operation, params: {}, account: 'test@test.com' };
}

describe('draftOnlyEmail', () => {
  beforeAll(() => configurePolicies([draftOnlyEmail]));
  afterAll(() => configurePolicies([]));

  it('blocks send', async () => {
    const result = await evaluatePolicies([], ctx('send'), 'gmail');
    expect(result.action).toBe('block');
    expect(result.reason).toContain('draft-only');
  });

  it('blocks reply', async () => {
    expect((await evaluatePolicies([], ctx('reply'), 'gmail')).action).toBe('block');
  });

  it('blocks replyAll', async () => {
    expect((await evaluatePolicies([], ctx('replyAll'), 'gmail')).action).toBe('block');
  });

  it('blocks forward', async () => {
    expect((await evaluatePolicies([], ctx('forward'), 'gmail')).action).toBe('block');
  });

  it('allows search', async () => {
    expect((await evaluatePolicies([], ctx('search'), 'gmail')).action).toBe('allow');
  });

  it('allows triage', async () => {
    expect((await evaluatePolicies([], ctx('triage'), 'gmail')).action).toBe('allow');
  });

  it('allows read', async () => {
    expect((await evaluatePolicies([], ctx('read'), 'gmail')).action).toBe('allow');
  });

  it('does not apply to other services', async () => {
    expect((await evaluatePolicies([], ctx('delete'), 'drive')).action).toBe('allow');
  });
});

describe('noDelete', () => {
  beforeAll(() => configurePolicies([noDelete]));
  afterAll(() => configurePolicies([]));

  it('blocks drive delete', async () => {
    const result = await evaluatePolicies([], ctx('delete'), 'drive');
    expect(result.action).toBe('block');
    expect(result.reason).toContain('no-delete');
  });

  it('blocks calendar delete', async () => {
    expect((await evaluatePolicies([], ctx('delete'), 'calendar')).action).toBe('block');
  });

  it('blocks task delete', async () => {
    expect((await evaluatePolicies([], ctx('delete'), 'tasks')).action).toBe('block');
  });

  it('blocks deleteTaskList', async () => {
    expect((await evaluatePolicies([], ctx('deleteTaskList'), 'tasks')).action).toBe('block');
  });

  it('allows gmail trash (reversible)', async () => {
    expect((await evaluatePolicies([], ctx('trash'), 'gmail')).action).toBe('allow');
  });

  it('allows search', async () => {
    expect((await evaluatePolicies([], ctx('search'), 'drive')).action).toBe('allow');
  });
});

describe('readOnly', () => {
  beforeAll(() => configurePolicies([readOnly]));
  afterAll(() => configurePolicies([]));

  it('allows search', async () => {
    expect((await evaluatePolicies([], ctx('search'), 'gmail')).action).toBe('allow');
  });

  it('allows list', async () => {
    expect((await evaluatePolicies([], ctx('list'), 'calendar')).action).toBe('allow');
  });

  it('allows triage', async () => {
    expect((await evaluatePolicies([], ctx('triage'), 'gmail')).action).toBe('allow');
  });

  it('blocks send', async () => {
    expect((await evaluatePolicies([], ctx('send'), 'gmail')).action).toBe('block');
  });

  it('blocks create', async () => {
    expect((await evaluatePolicies([], ctx('create'), 'calendar')).action).toBe('block');
  });

  it('blocks delete', async () => {
    expect((await evaluatePolicies([], ctx('delete'), 'drive')).action).toBe('block');
  });

  it('blocks upload', async () => {
    expect((await evaluatePolicies([], ctx('upload'), 'drive')).action).toBe('block');
  });
});

describe('policy composition', () => {
  beforeAll(() => configurePolicies([auditLog, draftOnlyEmail, noDelete]));
  afterAll(() => configurePolicies([]));

  it('audit allows but draftOnly blocks send', async () => {
    const result = await evaluatePolicies([], ctx('send'), 'gmail');
    expect(result.action).toBe('block');
  });

  it('audit allows and noDelete blocks drive delete', async () => {
    const result = await evaluatePolicies([], ctx('delete'), 'drive');
    expect(result.action).toBe('block');
  });

  it('all allow search', async () => {
    const result = await evaluatePolicies([], ctx('search'), 'gmail');
    expect(result.action).toBe('allow');
  });
});

describe('no policies configured', () => {
  beforeAll(() => configurePolicies([]));

  it('allows everything', async () => {
    expect((await evaluatePolicies([], ctx('send'), 'gmail')).action).toBe('allow');
    expect((await evaluatePolicies([], ctx('delete'), 'drive')).action).toBe('allow');
  });
});
