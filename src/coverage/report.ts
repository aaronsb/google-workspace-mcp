/**
 * Format coverage reports for terminal and JSON output.
 */

import type { CoverageReport } from './types.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function bar(covered: number, total: number, width = 20): string {
  if (total === 0) return DIM + '░'.repeat(width) + RESET;
  const filled = Math.round((covered / total) * width);
  const color = (covered / total) >= 0.5 ? GREEN : (covered / total) >= 0.25 ? YELLOW : RED;
  return color + '█'.repeat(filled) + RESET + DIM + '░'.repeat(width - filled) + RESET;
}

function pct(n: number, total: number): string {
  if (total === 0) return '  -';
  return `${Math.round((n / total) * 100).toString().padStart(3)}%`;
}

export function formatTerminalReport(report: CoverageReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}gws CLI Coverage Analysis${RESET}`);
  lines.push(`${DIM}gws version: ${report.gwsVersion}${RESET}`);
  lines.push(`${DIM}timestamp:   ${report.timestamp}${RESET}`);
  lines.push('');

  // Summary
  lines.push(`${BOLD}Coverage: ${report.coveredOps}/${report.totalOps} operations (${report.coveragePercent}%)${RESET}`);
  lines.push('');

  // Per-service table
  const header = `  ${'Service'.padEnd(14)} ${'Covered'.padStart(8)}  ${' '.repeat(20)}  ${'Pct'.padStart(4)}  ${'Gaps'.padStart(5)}  ${'Excl'.padStart(5)}`;
  lines.push(`${DIM}${header}${RESET}`);
  lines.push(`${DIM}  ${'─'.repeat(14)} ${'─'.repeat(8)}  ${'─'.repeat(20)}  ${'─'.repeat(4)}  ${'─'.repeat(5)}  ${'─'.repeat(5)}${RESET}`);

  for (const svc of report.services) {
    if (svc.totalOps === 0) continue;
    const svcName = svc.service.padEnd(14);
    const ratio = `${svc.coveredOps}/${svc.totalOps}`.padStart(8);
    const barStr = bar(svc.coveredOps, svc.totalOps);
    const pctStr = pct(svc.coveredOps, svc.totalOps);
    const gapStr = (svc.gapOps > 0 ? `${svc.gapOps}` : '-').padStart(5);
    const exclStr = (svc.excludedOps > 0 ? `${svc.excludedOps}` : '-').padStart(5);
    lines.push(`  ${svcName} ${ratio}  ${barStr}  ${pctStr}  ${gapStr}  ${exclStr}`);
  }

  // Uncovered services
  const uncoveredServices = report.services.filter(s => s.coveredOps === 0 && s.totalOps > 0);
  if (uncoveredServices.length > 0) {
    lines.push('');
    lines.push(`${BOLD}Uncovered services:${RESET}`);
    for (const svc of uncoveredServices) {
      lines.push(`  ${YELLOW}${svc.service}${RESET} — ${svc.totalOps} operations available`);
    }
  }

  // New operations since baseline
  const newOps = report.services.flatMap(s => s.newOps.map(op => ({ service: s.service, op })));
  if (newOps.length > 0) {
    lines.push('');
    lines.push(`${BOLD}New since baseline:${RESET}`);
    for (const { service, op } of newOps) {
      lines.push(`  ${GREEN}+${RESET} ${CYAN}${service}${RESET} ${op}`);
    }
  }

  // Removed operations
  const removedOps = report.services.flatMap(s => s.removedOps.map(op => ({ service: s.service, op })));
  if (removedOps.length > 0) {
    lines.push('');
    lines.push(`${BOLD}Removed from gws:${RESET}`);
    for (const { service, op } of removedOps) {
      lines.push(`  ${RED}-${RESET} ${CYAN}${service}${RESET} ${op}`);
    }
  }

  // Parameter gaps
  const allParamGaps = report.services.flatMap(s =>
    Object.entries(s.paramGaps).map(([op, gaps]) => ({ service: s.service, op, gaps })),
  );
  if (allParamGaps.length > 0) {
    lines.push('');
    lines.push(`${BOLD}Parameter gaps in covered operations:${RESET}`);
    for (const { service, op, gaps } of allParamGaps) {
      lines.push(`  ${CYAN}${service}${RESET} ${op}:`);
      for (const gap of gaps) {
        lines.push(`    ${YELLOW}+${RESET} ${gap.paramName} ${DIM}(${gap.details || 'missing'})${RESET}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function formatJsonReport(report: CoverageReport): string {
  return JSON.stringify(report, null, 2);
}
