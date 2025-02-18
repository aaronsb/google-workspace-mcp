import { Tool } from "@modelcontextprotocol/sdk/types.js";
import logger from '../../utils/logger.js';

export interface ToolMetadata extends Tool {
  category: string;
  aliases?: string[];
}

export interface ToolCategory {
  name: string;
  description: string;
  tools: ToolMetadata[];
}

export class ToolRegistry {
  private tools: Map<string, ToolMetadata> = new Map();
  private categories: Map<string, ToolCategory> = new Map();
  private aliasMap: Map<string, string> = new Map();

  constructor(tools: ToolMetadata[]) {
    this.registerTools(tools);
  }

  private registerTools(tools: ToolMetadata[]): void {
    for (const tool of tools) {
      // Register the main tool
      this.tools.set(tool.name, tool);

      // Register category
      if (!this.categories.has(tool.category)) {
        this.categories.set(tool.category, {
          name: tool.category,
          description: '', // Could be added in future
          tools: []
        });
      }
      this.categories.get(tool.category)?.tools.push(tool);

      // Register aliases
      if (tool.aliases) {
        for (const alias of tool.aliases) {
          this.aliasMap.set(alias, tool.name);
        }
      }
    }
  }

  getTool(name: string): ToolMetadata | undefined {
    // Try direct lookup
    const tool = this.tools.get(name);
    if (tool) {
      return tool;
    }

    // Try alias lookup
    const mainName = this.aliasMap.get(name);
    if (mainName) {
      return this.tools.get(mainName);
    }

    return undefined;
  }

  getAllTools(): ToolMetadata[] {
    return Array.from(this.tools.values());
  }

  getCategories(): ToolCategory[] {
    return Array.from(this.categories.values());
  }

  private calculateLevenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  findSimilarTools(name: string, maxSuggestions: number = 3): ToolMetadata[] {
    const allTools = this.getAllTools();
    const distances: Array<{ tool: ToolMetadata; distance: number }> = [];

    // Calculate distances for all tools and their aliases
    for (const tool of allTools) {
      // Check main tool name
      const mainDistance = this.calculateLevenshteinDistance(name.toLowerCase(), tool.name.toLowerCase());
      distances.push({ tool, distance: mainDistance });

      // Check aliases
      if (tool.aliases) {
        for (const alias of tool.aliases) {
          const aliasDistance = this.calculateLevenshteinDistance(name.toLowerCase(), alias.toLowerCase());
          if (aliasDistance < mainDistance) {
            // Update with better match if found
            const existing = distances.find(d => d.tool === tool);
            if (existing) {
              existing.distance = aliasDistance;
            }
          }
        }
      }
    }

    // Sort by distance and return top matches
    return distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxSuggestions)
      .map(d => d.tool);
  }

  formatErrorWithSuggestions(invalidToolName: string): string {
    const similarTools = this.findSimilarTools(invalidToolName);
    const categories = this.getCategories();

    let message = `Tool '${invalidToolName}' not found.\n\n`;

    if (similarTools.length > 0) {
      message += 'Did you mean:\n';
      for (const tool of similarTools) {
        message += `- ${tool.name} (${tool.category})\n`;
        if (tool.aliases && tool.aliases.length > 0) {
          message += `  Aliases: ${tool.aliases.join(', ')}\n`;
        }
      }
      message += '\n';
    }

    message += 'Available categories:\n';
    for (const category of categories) {
      const toolNames = category.tools.map(t => t.name.replace('workspace_', '')).join(', ');
      message += `- ${category.name}: ${toolNames}\n`;
    }

    return message;
  }

  // Helper method to get all available tool names including aliases
  getAllToolNames(): string[] {
    const names: string[] = [];
    for (const tool of this.tools.values()) {
      names.push(tool.name);
      if (tool.aliases) {
        names.push(...tool.aliases);
      }
    }
    return names;
  }
}
