import { buildMimeMessage, lookupMimeType } from '../../../services/gmail/mime.js';

/** Decode a base64url string back to UTF-8. */
function decodeRaw(raw: string): string {
  const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

describe('lookupMimeType', () => {
  it('returns correct MIME type for known extensions', () => {
    expect(lookupMimeType('report.pdf')).toBe('application/pdf');
    expect(lookupMimeType('invoice.md')).toBe('text/markdown');
    expect(lookupMimeType('photo.jpg')).toBe('image/jpeg');
    expect(lookupMimeType('data.csv')).toBe('text/csv');
    expect(lookupMimeType('archive.zip')).toBe('application/zip');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(lookupMimeType('file.xyz')).toBe('application/octet-stream');
    expect(lookupMimeType('noext')).toBe('application/octet-stream');
  });

  it('is case-insensitive for extensions', () => {
    expect(lookupMimeType('FILE.PDF')).toBe('application/pdf');
    expect(lookupMimeType('image.PNG')).toBe('image/png');
  });
});

describe('buildMimeMessage', () => {
  const plainAttachment: { filename: string; mimeType: string; content: Buffer } = {
    filename: 'invoice.md',
    mimeType: 'text/markdown',
    content: Buffer.from('# Invoice\n\nAmount: $100'),
  };

  it('produces valid base64url (no +, /, or = characters)', () => {
    const raw = buildMimeMessage({
      to: 'test@example.com',
      subject: 'Test',
      body: 'Hello',
      attachments: [plainAttachment],
    });

    expect(raw).not.toMatch(/[+/=]/);
  });

  it('decodes to a valid MIME multipart message', () => {
    const raw = buildMimeMessage({
      to: 'test@example.com',
      subject: 'Test subject',
      body: 'Hello world',
      attachments: [plainAttachment],
    });

    const message = decodeRaw(raw);

    expect(message).toContain('MIME-Version: 1.0');
    expect(message).toContain('Content-Type: multipart/mixed; boundary=');
    expect(message).toContain('To: test@example.com');
    expect(message).toContain('Subject: Test subject');
    expect(message).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(message).toContain('Content-Disposition: attachment; filename="invoice.md"');
  });

  it('includes From, Cc, Bcc headers when provided', () => {
    const raw = buildMimeMessage({
      to: 'to@example.com',
      subject: 'Test',
      body: 'Hi',
      from: 'from@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      attachments: [plainAttachment],
    });

    const message = decodeRaw(raw);
    expect(message).toContain('From: from@example.com');
    expect(message).toContain('Cc: cc@example.com');
    expect(message).toContain('Bcc: bcc@example.com');
  });

  it('uses text/html content type when html flag is set', () => {
    const raw = buildMimeMessage({
      to: 'test@example.com',
      subject: 'Test',
      body: '<b>Bold</b>',
      html: true,
      attachments: [plainAttachment],
    });

    const message = decodeRaw(raw);
    expect(message).toContain('Content-Type: text/html; charset=UTF-8');
  });

  it('handles multiple attachments', () => {
    const raw = buildMimeMessage({
      to: 'test@example.com',
      subject: 'Test',
      body: 'See attached',
      attachments: [
        plainAttachment,
        {
          filename: 'data.csv',
          mimeType: 'text/csv',
          content: Buffer.from('a,b,c\n1,2,3'),
        },
      ],
    });

    const message = decodeRaw(raw);
    expect(message).toContain('filename="invoice.md"');
    expect(message).toContain('filename="data.csv"');
  });

  it('encodes non-ASCII subjects with RFC 2047', () => {
    const raw = buildMimeMessage({
      to: 'test@example.com',
      subject: 'Factura de febrero',
      body: 'Hello',
      attachments: [plainAttachment],
    });

    const message = decodeRaw(raw);
    // ASCII-only subjects should not be encoded
    expect(message).not.toContain('=?UTF-8?B?');
  });

  it('encodes subjects with non-ASCII characters using RFC 2047', () => {
    const raw = buildMimeMessage({
      to: 'test@example.com',
      subject: 'Rechnung für Februar',
      body: 'Hello',
      attachments: [plainAttachment],
    });

    const message = decodeRaw(raw);
    expect(message).toContain('=?UTF-8?B?');
    // Verify the encoded subject decodes correctly
    const match = message.match(/Subject: =\?UTF-8\?B\?(.+?)\?=/);
    expect(match).toBeTruthy();
    const decoded = Buffer.from(match![1], 'base64').toString('utf-8');
    expect(decoded).toBe('Rechnung für Februar');
  });

  it('preserves binary attachment content through round-trip', () => {
    // Create a buffer with all byte values 0-255
    const binaryContent = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binaryContent[i] = i;

    const raw = buildMimeMessage({
      to: 'test@example.com',
      subject: 'Binary test',
      body: 'See attached',
      attachments: [{
        filename: 'binary.bin',
        mimeType: 'application/octet-stream',
        content: binaryContent,
      }],
    });

    const message = decodeRaw(raw);

    // Find the attachment's base64 content (after the empty line following headers)
    const parts = message.split(/----=_Part_/);
    const attachmentPart = parts.find(p => p.includes('filename="binary.bin"'));
    expect(attachmentPart).toBeTruthy();

    // Extract base64 data (after the blank line that separates headers from body)
    const attachmentBody = attachmentPart!.split('\r\n\r\n')[1];
    // Remove trailing boundary marker if present
    const base64Data = attachmentBody.split('\r\n--')[0].replace(/\r\n/g, '');
    const decoded = Buffer.from(base64Data, 'base64');
    expect(decoded).toEqual(binaryContent);
  });

  it('throws on messages exceeding 5MB', () => {
    const largeContent = Buffer.alloc(4 * 1024 * 1024); // 4MB → ~5.3MB after base64

    expect(() => buildMimeMessage({
      to: 'test@example.com',
      subject: 'Large',
      body: 'See attached',
      attachments: [{
        filename: 'large.bin',
        mimeType: 'application/octet-stream',
        content: largeContent,
      }],
    })).toThrow(/exceeds Gmail's 5MB limit/);
  });
});
