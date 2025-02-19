import { jest } from '@jest/globals';

export const google = {
  drive: jest.fn().mockReturnValue({
    files: {
      list: jest.fn(),
      create: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      export: jest.fn()
    },
    permissions: {
      create: jest.fn()
    }
  }),
  gmail: jest.fn().mockReturnValue({
    users: {
      messages: {
        list: jest.fn(),
        get: jest.fn(),
        send: jest.fn()
      },
      drafts: {
        create: jest.fn(),
        list: jest.fn(),
        get: jest.fn(),
        send: jest.fn()
      },
      getProfile: jest.fn(),
      settings: {
        getAutoForwarding: jest.fn(),
        getImap: jest.fn(),
        getLanguage: jest.fn(),
        getPop: jest.fn(),
        getVacation: jest.fn()
      }
    }
  })
};
