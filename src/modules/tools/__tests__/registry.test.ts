import { ToolRegistry, ToolMetadata } from '../registry.js';

describe('ToolRegistry', () => {
  const mockTools: ToolMetadata[] = [
    {
      name: 'create_workspace_label',
      category: 'Gmail/Labels',
      description: 'Create a new label',
      aliases: ['create_label', 'new_label', 'create_gmail_label'],
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      }
    },
    {
      name: 'send_workspace_email',
      category: 'Gmail/Messages',
      description: 'Send an email',
      aliases: ['send_email', 'send_mail'],
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string' }
        }
      }
    },
    {
      name: 'create_workspace_calendar_event',
      category: 'Calendar/Events',
      description: 'Create calendar event',
      aliases: ['create_event', 'schedule_event'],
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' }
        }
      }
    }
  ];

  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(mockTools);
  });

  describe('getTool', () => {
    it('should find tool by main name', () => {
      const tool = registry.getTool('create_workspace_label');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('create_workspace_label');
    });

    it('should find tool by alias', () => {
      const tool = registry.getTool('create_gmail_label');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('create_workspace_label');
    });

    it('should return undefined for unknown tool', () => {
      const tool = registry.getTool('nonexistent_tool');
      expect(tool).toBeUndefined();
    });
  });

  describe('getAllTools', () => {
    it('should return all registered tools', () => {
      const tools = registry.getAllTools();
      expect(tools).toHaveLength(3);
      expect(tools.map(t => t.name)).toContain('create_workspace_label');
      expect(tools.map(t => t.name)).toContain('send_workspace_email');
      expect(tools.map(t => t.name)).toContain('create_workspace_calendar_event');
    });
  });

  describe('getCategories', () => {
    it('should return tools organized by category', () => {
      const categories = registry.getCategories();
      expect(categories).toHaveLength(3);
      
      const categoryNames = categories.map(c => c.name);
      expect(categoryNames).toContain('Gmail/Labels');
      expect(categoryNames).toContain('Gmail/Messages');
      expect(categoryNames).toContain('Calendar/Events');

      const labelCategory = categories.find(c => c.name === 'Gmail/Labels');
      expect(labelCategory?.tools).toHaveLength(1);
      expect(labelCategory?.tools[0].name).toBe('create_workspace_label');
    });
  });

  describe('findSimilarTools', () => {
    it('should find similar tools by name', () => {
      const similar = registry.findSimilarTools('create_label_workspace');
      expect(similar).toHaveLength(1);
      expect(similar[0].name).toBe('create_workspace_label');
    });

    it('should find similar tools by alias', () => {
      const similar = registry.findSimilarTools('gmail_label_create');
      expect(similar).toHaveLength(1);
      expect(similar[0].name).toBe('create_workspace_label');
    });

    it('should respect maxSuggestions limit', () => {
      const similar = registry.findSimilarTools('create', 2);
      expect(similar).toHaveLength(2);
    });
  });

  describe('formatErrorWithSuggestions', () => {
    it('should format error message with suggestions', () => {
      const message = registry.formatErrorWithSuggestions('create_gmail_lable');
      expect(message).toContain('Tool \'create_gmail_lable\' not found');
      expect(message).toContain('Did you mean:');
      expect(message).toContain('create_workspace_label (Gmail/Labels)');
      expect(message).toContain('Available categories:');
    });

    it('should include aliases in error message', () => {
      const message = registry.formatErrorWithSuggestions('send_mail_workspace');
      expect(message).toContain('send_workspace_email');
      expect(message).toContain('Aliases: send_email, send_mail');
    });
  });

  describe('getAllToolNames', () => {
    it('should return all tool names including aliases', () => {
      const names = registry.getAllToolNames();
      expect(names).toContain('create_workspace_label');
      expect(names).toContain('create_gmail_label');
      expect(names).toContain('send_workspace_email');
      expect(names).toContain('send_mail');
    });
  });
});
