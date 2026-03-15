/**
 * Integration test setup — resolves test account from:
 *   1. TEST_ACCOUNT env var (explicit override)
 *   2. First account in accounts.json (default)
 *
 * Skips the entire suite if no accounts or credentials are configured,
 * so CI without credentials just reports "skipped" rather than failing.
 */

import * as fs from 'node:fs';
import { accountsFilePath, credentialPath } from '../../executor/paths.js';

interface TestAccount {
  email: string;
  credentialFile: string;
}

let cachedAccount: TestAccount | null | undefined;

export function getTestAccount(): TestAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;

  try {
    // Prefer explicit override
    const override = process.env.TEST_ACCOUNT;
    if (override) {
      const credFile = credentialPath(override);
      if (!fs.existsSync(credFile)) {
        console.warn(`TEST_ACCOUNT=${override} but no credential file at ${credFile}`);
        cachedAccount = null;
        return null;
      }
      cachedAccount = { email: override, credentialFile: credFile };
      return cachedAccount;
    }

    // Fall back to first account in registry
    const raw = fs.readFileSync(accountsFilePath(), 'utf-8');
    const { accounts } = JSON.parse(raw);
    if (!accounts?.length) {
      cachedAccount = null;
      return null;
    }

    const email = accounts[0].email;
    const credFile = credentialPath(email);

    if (!fs.existsSync(credFile)) {
      cachedAccount = null;
      return null;
    }

    cachedAccount = { email, credentialFile: credFile };
    return cachedAccount;
  } catch {
    cachedAccount = null;
    return null;
  }
}

/**
 * Call at the top of an integration describe block.
 * Returns the test account or skips the suite.
 */
export function requireTestAccount(): TestAccount {
  const account = getTestAccount();
  if (!account) {
    // Jest doesn't have suite-level skip, so we use a conditional describe pattern
    throw new Error('No test account available — skipping integration tests');
  }
  return account;
}
