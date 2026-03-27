import { validateWorkspaceDir, resolveWorkspacePath, getWorkspaceDir, checkWorkspaceStatus, sanitizePath } from '../../executor/workspace.js';
import * as os from 'node:os';
import * as path from 'node:path';

const HOME = os.homedir();

describe('validateWorkspaceDir', () => {
  it('allows a dedicated subdirectory', () => {
    expect(() => validateWorkspaceDir('/tmp/mcp-workspace')).not.toThrow();
  });

  it('allows subdirectory of Documents', () => {
    expect(() => validateWorkspaceDir(path.join(HOME, 'Documents', 'mcp-workspace'))).not.toThrow();
  });

  it('rejects home directory itself', () => {
    expect(() => validateWorkspaceDir(HOME)).toThrow(/cannot be/);
  });

  it('rejects Documents directory itself', () => {
    expect(() => validateWorkspaceDir(path.join(HOME, 'Documents'))).toThrow(/cannot be/);
  });

  it('rejects Desktop directory itself', () => {
    expect(() => validateWorkspaceDir(path.join(HOME, 'Desktop'))).toThrow(/cannot be/);
  });

  it('rejects Downloads directory itself', () => {
    expect(() => validateWorkspaceDir(path.join(HOME, 'Downloads'))).toThrow(/cannot be/);
  });

  it('rejects Google Drive mount paths', () => {
    expect(() => validateWorkspaceDir('/home/user/Google Drive/workspace')).toThrow(/Google Drive/);
    expect(() => validateWorkspaceDir('/home/user/google-drive/files')).toThrow(/Google Drive/);
    expect(() => validateWorkspaceDir('/Users/user/My Drive/stuff')).toThrow(/Google Drive/);
  });

  it('rejects filesystem root', () => {
    expect(() => validateWorkspaceDir('/')).toThrow(/filesystem root/);
  });

  it('allows XDG data directory', () => {
    expect(() => validateWorkspaceDir(path.join(HOME, '.local', 'share', 'google-workspace-mcp', 'workspace'))).not.toThrow();
  });
});

describe('sanitizePath', () => {
  it('preserves directory separators', () => {
    expect(sanitizePath('reports/q1/summary.csv')).toBe(path.join('reports', 'q1', 'summary.csv'));
  });

  it('sanitizes each segment individually', () => {
    expect(sanitizePath('reports/<bad>/file.txt')).toBe(path.join('reports', '_bad_', 'file.txt'));
  });

  it('rejects .. traversal segments', () => {
    expect(() => sanitizePath('../etc/passwd')).toThrow(/traversal/);
    expect(() => sanitizePath('reports/../../etc/passwd')).toThrow(/traversal/);
  });

  it('rejects . segments', () => {
    expect(() => sanitizePath('./file.txt')).toThrow(/traversal/);
  });

  it('handles empty input', () => {
    expect(sanitizePath('')).toBe('unnamed');
  });

  it('collapses empty segments from double slashes', () => {
    expect(sanitizePath('reports//q1///file.txt')).toBe(path.join('reports', 'q1', 'file.txt'));
  });

  it('normalizes backslashes', () => {
    expect(sanitizePath('reports\\q1\\file.txt')).toBe(path.join('reports', 'q1', 'file.txt'));
  });

  it('strips leading dots from segments', () => {
    expect(sanitizePath('.hidden/file.txt')).toBe(path.join('hidden', 'file.txt'));
  });

  it('handles single filename (no separators)', () => {
    expect(sanitizePath('report.csv')).toBe('report.csv');
  });
});

describe('resolveWorkspacePath', () => {
  const origEnv = process.env.WORKSPACE_DIR;

  beforeEach(() => {
    process.env.WORKSPACE_DIR = '/tmp/test-workspace';
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.WORKSPACE_DIR = origEnv;
    } else {
      delete process.env.WORKSPACE_DIR;
    }
  });

  it('resolves filename within workspace', () => {
    const resolved = resolveWorkspacePath('report.csv');
    expect(resolved).toBe('/tmp/test-workspace/report.csv');
  });

  it('resolves nested path within workspace', () => {
    const resolved = resolveWorkspacePath('reports/q1/summary.csv');
    expect(resolved).toBe('/tmp/test-workspace/reports/q1/summary.csv');
  });

  it('rejects path traversal via ..', () => {
    expect(() => resolveWorkspacePath('../../etc/passwd')).toThrow(/traversal/);
  });

  it('sanitizes dangerous characters in path segments', () => {
    const resolved = resolveWorkspacePath('reports/<bad>/file.txt');
    expect(resolved).toBe('/tmp/test-workspace/reports/_bad_/file.txt');
  });

  it('sanitizes null bytes and control characters', () => {
    const resolved = resolveWorkspacePath('file\x00.txt');
    expect(resolved).toBe('/tmp/test-workspace/file.txt');
    expect(resolved).not.toContain('\x00');
  });
});

describe('getWorkspaceDir', () => {
  const origEnv = process.env.WORKSPACE_DIR;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.WORKSPACE_DIR = origEnv;
    } else {
      delete process.env.WORKSPACE_DIR;
    }
  });

  it('returns WORKSPACE_DIR when set', () => {
    process.env.WORKSPACE_DIR = '/custom/workspace';
    expect(getWorkspaceDir()).toBe('/custom/workspace');
  });

  it('returns default when WORKSPACE_DIR is unset', () => {
    delete process.env.WORKSPACE_DIR;
    expect(getWorkspaceDir()).toContain('google-workspace-mcp');
    expect(getWorkspaceDir()).toContain('workspace');
  });
});

describe('checkWorkspaceStatus', () => {
  const origEnv = process.env.WORKSPACE_DIR;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.WORKSPACE_DIR = origEnv;
    } else {
      delete process.env.WORKSPACE_DIR;
    }
  });

  it('returns valid for safe path', () => {
    process.env.WORKSPACE_DIR = '/tmp/mcp-workspace';
    const status = checkWorkspaceStatus();
    expect(status.valid).toBe(true);
    expect(status.warning).toBeUndefined();
  });

  it('returns warning for unsafe path without crashing', () => {
    process.env.WORKSPACE_DIR = HOME;
    const status = checkWorkspaceStatus();
    expect(status.valid).toBe(false);
    expect(status.warning).toContain('cannot be');
  });
});
