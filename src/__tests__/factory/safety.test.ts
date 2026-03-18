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

  it('blocks send', () => {
    const result = evaluatePolicies([], ctx('send'), 'gmail');
    expect(result.action).toBe('block');
    expect(result.reason).toContain('draft-only');
  });

  it('blocks reply', () => {
    expect(evaluatePolicies([], ctx('reply'), 'gmail').action).toBe('block');
  });

  it('blocks replyAll', () => {
    expect(evaluatePolicies([], ctx('replyAll'), 'gmail').action).toBe('block');
  });

  it('blocks forward', () => {
    expect(evaluatePolicies([], ctx('forward'), 'gmail').action).toBe('block');
  });

  it('allows search', () => {
    expect(evaluatePolicies([], ctx('search'), 'gmail').action).toBe('allow');
  });

  it('allows triage', () => {
    expect(evaluatePolicies([], ctx('triage'), 'gmail').action).toBe('allow');
  });

  it('allows read', () => {
    expect(evaluatePolicies([], ctx('read'), 'gmail').action).toBe('allow');
  });

  it('does not apply to other services', () => {
    expect(evaluatePolicies([], ctx('delete'), 'drive').action).toBe('allow');
  });
});

describe('noDelete', () => {
  beforeAll(() => configurePolicies([noDelete]));
  afterAll(() => configurePolicies([]));

  it('blocks drive delete', () => {
    const result = evaluatePolicies([], ctx('delete'), 'drive');
    expect(result.action).toBe('block');
    expect(result.reason).toContain('no-delete');
  });

  it('blocks calendar delete', () => {
    expect(evaluatePolicies([], ctx('delete'), 'calendar').action).toBe('block');
  });

  it('blocks task delete', () => {
    expect(evaluatePolicies([], ctx('delete'), 'tasks').action).toBe('block');
  });

  it('blocks deleteTaskList', () => {
    expect(evaluatePolicies([], ctx('deleteTaskList'), 'tasks').action).toBe('block');
  });

  it('allows gmail trash (reversible)', () => {
    expect(evaluatePolicies([], ctx('trash'), 'gmail').action).toBe('allow');
  });

  it('allows search', () => {
    expect(evaluatePolicies([], ctx('search'), 'drive').action).toBe('allow');
  });
});

describe('readOnly', () => {
  beforeAll(() => configurePolicies([readOnly]));
  afterAll(() => configurePolicies([]));

  it('allows search', () => {
    expect(evaluatePolicies([], ctx('search'), 'gmail').action).toBe('allow');
  });

  it('allows list', () => {
    expect(evaluatePolicies([], ctx('list'), 'calendar').action).toBe('allow');
  });

  it('allows triage', () => {
    expect(evaluatePolicies([], ctx('triage'), 'gmail').action).toBe('allow');
  });

  it('blocks send', () => {
    expect(evaluatePolicies([], ctx('send'), 'gmail').action).toBe('block');
  });

  it('blocks create', () => {
    expect(evaluatePolicies([], ctx('create'), 'calendar').action).toBe('block');
  });

  it('blocks delete', () => {
    expect(evaluatePolicies([], ctx('delete'), 'drive').action).toBe('block');
  });

  it('blocks upload', () => {
    expect(evaluatePolicies([], ctx('upload'), 'drive').action).toBe('block');
  });
});

describe('policy composition', () => {
  beforeAll(() => configurePolicies([auditLog, draftOnlyEmail, noDelete]));
  afterAll(() => configurePolicies([]));

  it('audit allows but draftOnly blocks send', () => {
    const result = evaluatePolicies([], ctx('send'), 'gmail');
    expect(result.action).toBe('block');
  });

  it('audit allows and noDelete blocks drive delete', () => {
    const result = evaluatePolicies([], ctx('delete'), 'drive');
    expect(result.action).toBe('block');
  });

  it('all allow search', () => {
    const result = evaluatePolicies([], ctx('search'), 'gmail');
    expect(result.action).toBe('allow');
  });
});

describe('no policies configured', () => {
  beforeAll(() => configurePolicies([]));

  it('allows everything', () => {
    expect(evaluatePolicies([], ctx('send'), 'gmail').action).toBe('allow');
    expect(evaluatePolicies([], ctx('delete'), 'drive').action).toBe('allow');
  });
});
