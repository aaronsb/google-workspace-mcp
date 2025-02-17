import { jest } from '@jest/globals';

export const google = {
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
