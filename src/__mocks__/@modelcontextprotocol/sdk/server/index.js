export class Server {
  constructor(config, options) {
    this.config = config;
    this.options = options;
  }

  async connect() {
    return Promise.resolve();
  }

  setRequestHandler() {
    // Mock implementation
  }
}
