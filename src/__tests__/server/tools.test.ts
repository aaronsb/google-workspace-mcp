import { allTools, getToolByName, getToolsByCategory } from '../../server/tools.js';

describe('tool registry', () => {
  it('has all expected tools', () => {
    const names = allTools.map(t => t.name);
    expect(names).toContain('list_accounts');
    expect(names).toContain('search_emails');
    expect(names).toContain('send_email');
    expect(names).toContain('get_calendar_events');
    expect(names).toContain('search_drive');
    expect(allTools.length).toBe(12);
  });

  it('getToolByName returns correct tool', () => {
    const tool = getToolByName('send_email');
    expect(tool?.category).toBe('email');
    expect(tool?.requiresAccount).toBe(true);
  });

  it('getToolByName returns undefined for unknown', () => {
    expect(getToolByName('nonexistent')).toBeUndefined();
  });

  it('getToolsByCategory filters correctly', () => {
    const emailTools = getToolsByCategory('email');
    expect(emailTools.length).toBe(4);
    emailTools.forEach(t => expect(t.category).toBe('email'));
  });
});

describe('toGwsArgs', () => {
  describe('search_emails', () => {
    const tool = getToolByName('search_emails')!;

    it('builds args with query', () => {
      const args = tool.toGwsArgs({ query: 'from:alice', maxResults: 5 });
      expect(args).toContain('gmail');
      const paramsStr = args[args.indexOf('--params') + 1];
      const params = JSON.parse(paramsStr);
      expect(params.q).toBe('from:alice');
      expect(params.maxResults).toBe(5);
      expect(params.userId).toBe('me');
    });

    it('clamps maxResults to 50', () => {
      const args = tool.toGwsArgs({ maxResults: 200 });
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.maxResults).toBe(50);
    });

    it('defaults maxResults to 10', () => {
      const args = tool.toGwsArgs({});
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.maxResults).toBe(10);
    });
  });

  describe('read_email', () => {
    const tool = getToolByName('read_email')!;

    it('builds args with messageId', () => {
      const args = tool.toGwsArgs({ messageId: 'abc123' });
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.id).toBe('abc123');
      expect(params.userId).toBe('me');
    });
  });

  describe('send_email', () => {
    const tool = getToolByName('send_email')!;

    it('builds +send args', () => {
      const args = tool.toGwsArgs({ to: 'bob@test.com', subject: 'Hi', body: 'Hello' });
      expect(args[0]).toBe('gmail');
      expect(args[1]).toBe('+send');
      expect(args[args.indexOf('--to') + 1]).toBe('bob@test.com');
      expect(args[args.indexOf('--subject') + 1]).toBe('Hi');
      expect(args[args.indexOf('--body') + 1]).toBe('Hello');
    });
  });

  describe('get_calendar_events', () => {
    const tool = getToolByName('get_calendar_events')!;

    it('defaults timeMin to today', () => {
      const args = tool.toGwsArgs({});
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.timeMin).toBeDefined();
      expect(params.calendarId).toBe('primary');
      expect(params.singleEvents).toBe(true);
    });

    it('uses provided timeMin', () => {
      const args = tool.toGwsArgs({ timeMin: '2026-01-01T00:00:00Z' });
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.timeMin).toBe('2026-01-01T00:00:00Z');
    });

    it('clamps maxResults to 50', () => {
      const args = tool.toGwsArgs({ maxResults: 100 });
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.maxResults).toBe(50);
    });
  });

  describe('create_calendar_event', () => {
    const tool = getToolByName('create_calendar_event')!;

    it('builds +insert args with required fields', () => {
      const args = tool.toGwsArgs({ summary: 'Meeting', start: '2026-03-14T10:00:00Z', end: '2026-03-14T11:00:00Z' });
      expect(args).toContain('+insert');
      expect(args[args.indexOf('--summary') + 1]).toBe('Meeting');
      expect(args[args.indexOf('--start') + 1]).toBe('2026-03-14T10:00:00Z');
    });

    it('includes optional fields when provided', () => {
      const args = tool.toGwsArgs({
        summary: 'Meeting', start: 'x', end: 'y',
        location: 'Room 1', attendees: 'a@b.com,c@d.com',
      });
      expect(args[args.indexOf('--location') + 1]).toBe('Room 1');
      expect(args[args.indexOf('--attendees') + 1]).toBe('a@b.com,c@d.com');
    });

    it('omits optional fields when not provided', () => {
      const args = tool.toGwsArgs({ summary: 'Meeting', start: 'x', end: 'y' });
      expect(args).not.toContain('--location');
      expect(args).not.toContain('--attendees');
    });
  });

  describe('search_drive', () => {
    const tool = getToolByName('search_drive')!;

    it('builds args with query', () => {
      const args = tool.toGwsArgs({ query: "name contains 'report'" });
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.q).toBe("name contains 'report'");
    });

    it('clamps pageSize to 50', () => {
      const args = tool.toGwsArgs({ maxResults: 999 });
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.pageSize).toBe(50);
    });
  });

  describe('upload_file', () => {
    const tool = getToolByName('upload_file')!;

    it('builds +upload args', () => {
      const args = tool.toGwsArgs({ filePath: '/tmp/report.pdf' });
      expect(args).toContain('+upload');
      expect(args).toContain('/tmp/report.pdf');
    });

    it('includes optional name and parent', () => {
      const args = tool.toGwsArgs({ filePath: '/tmp/f.txt', name: 'doc.txt', parentFolderId: 'abc' });
      expect(args[args.indexOf('--name') + 1]).toBe('doc.txt');
      expect(args[args.indexOf('--parent') + 1]).toBe('abc');
    });
  });
});
