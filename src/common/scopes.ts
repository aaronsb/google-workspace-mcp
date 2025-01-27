// Gmail scopes
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing'
];

// Calendar scopes
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events'
];

// Combined scopes for full access
export const ALL_SCOPES = [
  ...GMAIL_SCOPES,
  ...CALENDAR_SCOPES
];

// Scope utilities
export function combineScopes(...scopeArrays: string[][]): string[] {
  const uniqueScopes = new Set<string>();
  for (const scopes of scopeArrays) {
    for (const scope of scopes) {
      uniqueScopes.add(scope);
    }
  }
  return Array.from(uniqueScopes);
}
