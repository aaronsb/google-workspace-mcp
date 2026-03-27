import { lookupMimeType } from '../../../services/gmail/mime.js';

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

  it('handles filenames without extensions', () => {
    expect(lookupMimeType('Makefile')).toBe('application/octet-stream');
    expect(lookupMimeType('README')).toBe('application/octet-stream');
  });
});
