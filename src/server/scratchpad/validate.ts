/**
 * Format-specific validators for scratchpad content.
 * Each returns a status string appended to mutation responses.
 */

import type { ScratchpadFormat } from './manager.js';

/** Run format-specific validation, returning a status string. */
export function validate(lines: string[], format: ScratchpadFormat): string {
  if (lines.length === 0) return 'Status: empty';

  switch (format) {
    case 'text':
      return `Status: valid (${lines.length} lines)`;

    case 'markdown':
      return validateMarkdown(lines);

    case 'json':
      return validateJson(lines);

    case 'csv':
      return validateCsv(lines);

    default:
      return `Status: valid (${lines.length} lines)`;
  }
}

function validateMarkdown(lines: string[]): string {
  let codeBlockOpen = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (trimmed.startsWith('```')) {
      if (codeBlockOpen === -1) {
        codeBlockOpen = i + 1;
      } else {
        codeBlockOpen = -1;
      }
    }
  }

  if (codeBlockOpen !== -1) {
    return `Status: invalid at line ${codeBlockOpen} — unclosed code fence`;
  }

  return `Status: valid (${lines.length} lines)`;
}

function validateJson(lines: string[]): string {
  const text = lines.join('\n');
  try {
    JSON.parse(text);
    return `Status: valid (${lines.length} lines)`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const posMatch = msg.match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      let line = 1;
      let col = 1;
      for (let i = 0; i < pos && i < text.length; i++) {
        if (text[i] === '\n') { line++; col = 1; } else { col++; }
      }
      return `Status: invalid at line ${line}:${col} — ${msg.replace(/^.*?position \d+/, '').trim() || 'JSON syntax error'}`;
    }
    return `Status: invalid — ${msg}`;
  }
}

function validateCsv(lines: string[]): string {
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return `Status: valid (${lines.length} lines)`;

  const expectedCols = countCsvColumns(nonEmpty[0]);

  for (let i = 1; i < nonEmpty.length; i++) {
    const cols = countCsvColumns(nonEmpty[i]);
    if (cols !== expectedCols) {
      const lineNum = lines.indexOf(nonEmpty[i]) + 1;
      return `Status: invalid at line ${lineNum} — expected ${expectedCols} columns, got ${cols}`;
    }
  }

  return `Status: valid (${lines.length} lines, ${expectedCols} columns)`;
}

/** Count CSV columns handling quoted fields. */
function countCsvColumns(line: string): number {
  let cols = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols++;
    }
  }
  return cols;
}
