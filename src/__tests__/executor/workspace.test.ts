import { validateWorkspaceDir, resolveWorkspacePath, getWorkspaceDir, checkWorkspaceStatus } from '../../executor/workspace.js';
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
    const resolved = resolveWorkspacePath('exports/2026/report.csv');
    expect(resolved).toBe('/tmp/test-workspace/exports/2026/report.csv');
  });

  it('rejects path traversal with ../', () => {
    expect(() => resolveWorkspacePath('../../etc/passwd')).toThrow(/traversal/);
  });

  it('rejects absolute path outside workspace', () => {
    expect(() => resolveWorkspacePath('/etc/passwd')).toThrow(/traversal/);
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
