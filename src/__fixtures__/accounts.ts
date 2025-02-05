export const mockAccounts = {
  accounts: [
    {
      email: 'test@example.com',
      category: 'work',
      description: 'Test Work Account',
    },
    {
      email: 'test2@example.com',
      category: 'personal',
      description: 'Test Personal Account',
    },
  ],
};

export const mockTokens = {
  valid: {
    access_token: 'valid-token',
    refresh_token: 'refresh-token',
    expiry_date: Date.now() + 3600000,
  },
  expired: {
    access_token: 'expired-token',
    refresh_token: 'refresh-token',
    expiry_date: Date.now() - 3600000,
  },
};

export const mockGmailResponses = {
  messageList: {
    messages: [
      { id: 'msg1', threadId: 'thread1' },
      { id: 'msg2', threadId: 'thread2' },
    ],
    resultSizeEstimate: 2,
  },
  message: {
    id: 'msg1',
    threadId: 'thread1',
    labelIds: ['INBOX'],
    snippet: 'Email snippet',
    payload: {
      headers: [
        { name: 'From', value: 'sender@example.com' },
        { name: 'Subject', value: 'Test Subject' },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Date', value: '2024-01-01T00:00:00Z' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from('Test content').toString('base64') },
        },
      ],
    },
  },
};
