import { Tool } from "@modelcontextprotocol/sdk/types.js";

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

  private tokenize(name: string): string[] {
    return name.toLowerCase().split(/[_\s]+/);
  }

  private calculateSimilarityScore(searchTokens: string[], targetTokens: string[]): number {
    // First try exact token matching with position awareness
    const searchStr = searchTokens.join('_');
    const targetStr = targetTokens.join('_');
    
    // Perfect match
    if (searchStr === targetStr) {
      return 1.0;
    }
    
    // Check if tokens are the same but in different order
    const searchSet = new Set(searchTokens);
    const targetSet = new Set(targetTokens);
    if (searchSet.size === targetSet.size && 
        [...searchSet].every(token => targetSet.has(token))) {
      return 0.9;
    }

    // Calculate token-by-token similarity
    let score = 0;
    const usedTargetTokens = new Set<number>();
    let matchedTokens = 0;

    for (const searchToken of searchTokens) {
      let bestTokenScore = 0;
      let bestTokenIndex = -1;

      targetTokens.forEach((targetToken, index) => {
        if (usedTargetTokens.has(index)) return;

        // Exact match gets highest score
        if (searchToken === targetToken) {
          const positionPenalty = Math.abs(searchTokens.indexOf(searchToken) - index) * 0.1;
          const tokenScore = Math.max(0.8, 1.0 - positionPenalty);
          if (tokenScore > bestTokenScore) {
            bestTokenScore = tokenScore;
            bestTokenIndex = index;
          }
          return;
        }

        // Substring match gets good score
        if (targetToken.includes(searchToken) || searchToken.includes(targetToken)) {
          const tokenScore = 0.7;
          if (tokenScore > bestTokenScore) {
            bestTokenScore = tokenScore;
            bestTokenIndex = index;
          }
          return;
        }

        // Levenshtein distance for fuzzy matching
        const distance = this.calculateLevenshteinDistance(searchToken, targetToken);
        const maxLength = Math.max(searchToken.length, targetToken.length);
        const tokenScore = 1 - (distance / maxLength);
        
        if (tokenScore > 0.6 && tokenScore > bestTokenScore) {
          bestTokenScore = tokenScore;
          bestTokenIndex = index;
        }
      });

      if (bestTokenIndex !== -1) {
        score += bestTokenScore;
        usedTargetTokens.add(bestTokenIndex);
        matchedTokens++;
      }
    }

    // Penalize if not all tokens were matched
    const matchRatio = matchedTokens / searchTokens.length;
    const finalScore = (score / searchTokens.length) * matchRatio;

    // Additional penalty for length mismatch
    const lengthPenalty = Math.abs(searchTokens.length - targetTokens.length) * 0.1;
    return Math.max(0, finalScore - lengthPenalty);
  }

  private isCommonTypo(a: string, b: string): boolean {
    const commonTypos: { [key: string]: string[] } = {
      'label': ['lable', 'labl', 'lbl'],
      'email': ['emil', 'mail', 'emal'],
      'calendar': ['calender', 'calander', 'caldr'],
      'workspace': ['workspce', 'wrkspace', 'wrkspc'],
      'create': ['creat', 'crete', 'craete'],
      'message': ['mesage', 'msg', 'messge'],
      'draft': ['draf', 'drft', 'darft']
    };

    // Check both directions (a->b and b->a)
    for (const [word, typos] of Object.entries(commonTypos)) {
      if ((a === word && typos.includes(b)) || (b === word && typos.includes(a))) {
        return true;
      }
    }
    return false;
  }

  findSimilarTools(name: string, maxSuggestions: number = 3): ToolMetadata[] {
    const searchTokens = this.tokenize(name);
    const matches: Array<{ tool: ToolMetadata; score: number }> = [];

    for (const tool of this.getAllTools()) {
      let bestScore = 0;

      // Check main tool name
      const nameTokens = this.tokenize(tool.name);
      bestScore = this.calculateSimilarityScore(searchTokens, nameTokens);

      // Check for common typos in each token
      const hasCommonTypo = searchTokens.some(searchToken =>
        nameTokens.some(nameToken => this.isCommonTypo(searchToken, nameToken))
      );
      if (hasCommonTypo) {
        bestScore = Math.max(bestScore, 0.8); // Boost score for common typos
      }

      // Check aliases
      if (tool.aliases) {
        for (const alias of tool.aliases) {
          const aliasTokens = this.tokenize(alias);
          const aliasScore = this.calculateSimilarityScore(searchTokens, aliasTokens);
          
          // Check for common typos in aliases too
          if (searchTokens.some(searchToken =>
              aliasTokens.some(aliasToken => this.isCommonTypo(searchToken, aliasToken)))) {
            bestScore = Math.max(bestScore, 0.8);
          }
          
          bestScore = Math.max(bestScore, aliasScore);
        }
      }

      // More lenient threshold (0.4 instead of 0.5) and include common typos
      if (bestScore > 0.4 || hasCommonTypo) {
        matches.push({ tool, score: bestScore });
      }
    }

    // Sort by score (highest first) and return top matches
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSuggestions)
      .map(m => m.tool);
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
