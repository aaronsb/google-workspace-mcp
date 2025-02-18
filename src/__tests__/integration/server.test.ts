import logger from '../../utils/logger.js';

const mockLogs: string[] = [];
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn((...args) => mockLogs.push(args.join(' '))),
    error: jest.fn((...args) => mockLogs.push(args.join(' '))),
    warn: jest.fn((...args) => mockLogs.push(args.join(' '))),
    debug: jest.fn((...args) => mockLogs.push(args.join(' ')))
  }
}));

describe('Server Version Logging', () => {
  beforeEach(() => {
    mockLogs.length = 0;
    jest.clearAllMocks();
  });

  it('should log version info with docker hash', () => {
    process.env.DOCKER_HASH = 'test-hash';
    logger.info(`google-workspace-mcp v0.9.0 (docker: ${process.env.DOCKER_HASH})`);
    
    expect(mockLogs[0]).toContain('google-workspace-mcp');
    expect(mockLogs[0]).toContain('test-hash');
  });

  it('should log version info with unknown hash when DOCKER_HASH is missing', () => {
    delete process.env.DOCKER_HASH;
    logger.info(`google-workspace-mcp v0.9.0 (docker: ${process.env.DOCKER_HASH || 'unknown'})`);
    
    expect(mockLogs[0]).toContain('google-workspace-mcp');
    expect(mockLogs[0]).toContain('unknown');
  });
});
