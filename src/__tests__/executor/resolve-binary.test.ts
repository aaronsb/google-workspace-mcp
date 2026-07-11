import { afterAll, beforeEach, describe, expect, it, vi, type MockedFunction, type Mock } from 'vitest';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import { GwsError } from '../../executor/errors.js';

// Mock only the bits resolveGwsBinary uses — not spawn
vi.mock('node:fs', async () => ({
  ...(await vi.importActual<typeof import('node:fs')>('node:fs')),
  existsSync: vi.fn(),
}));

vi.mock('node:child_process', async () => ({
  ...(await vi.importActual<typeof import('node:child_process')>('node:child_process')),
  execFileSync: vi.fn(),
}));

// Must mock token-service since gws.ts imports it at module level
vi.mock('../../accounts/token-service.js', () => ({
  getAccessToken: vi.fn(),
}));

import { resolveGwsBinary } from '../../executor/gws.js';

const mockExistsSync = fs.existsSync as MockedFunction<typeof fs.existsSync>;
const mockExecFileSync = child_process.execFileSync as MockedFunction<typeof child_process.execFileSync>;

describe('resolveGwsBinary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GWS_BINARY_PATH;
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses GWS_BINARY_PATH env var (directory)', () => {
    process.env.GWS_BINARY_PATH = '/custom/bin';
    expect(resolveGwsBinary()).toBe('/custom/bin/gws');
  });

  it('uses GWS_BINARY_PATH env var (direct file path)', () => {
    process.env.GWS_BINARY_PATH = '/custom/bin/gws';
    expect(resolveGwsBinary()).toBe('/custom/bin/gws');
  });

  it('uses node_modules/.bin/gws when it exists', () => {
    mockExistsSync.mockReturnValue(true);
    expect(resolveGwsBinary()).toBe(
      path.join(process.cwd(), 'node_modules', '.bin', 'gws'),
    );
  });

  it('falls back to system PATH when node_modules missing', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockReturnValue('/usr/local/bin/gws\n' as any);
    expect(resolveGwsBinary()).toBe('/usr/local/bin/gws');
    expect(mockExecFileSync).toHaveBeenCalledWith('which', ['gws'], expect.any(Object));
  });

  it('throws GwsError with agent-friendly instructions when binary not found', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
    expect(() => resolveGwsBinary()).toThrow(GwsError);
    expect(() => resolveGwsBinary()).toThrow(/gws binary not found/);
    expect(() => resolveGwsBinary()).toThrow(/Do not retry/);
    expect(() => resolveGwsBinary()).toThrow(/@googleworkspace\/cli/);
  });
});
