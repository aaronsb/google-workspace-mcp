#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

async function setupGoogleEnv(): Promise<void> {
  try {
    // Ensure credentials directory exists
    const credentialsDir = path.join(ROOT_DIR, 'config', 'credentials');
    try {
      await fs.access(credentialsDir);
    } catch {
      await fs.mkdir(credentialsDir, { recursive: true });
    }

    // Read and encode the credentials file
    const gauthPath = path.join(ROOT_DIR, 'config', 'gauth.json');
    const credentials = await fs.readFile(gauthPath, 'utf8');
    const credentialsBase64 = Buffer.from(credentials).toString('base64');

    // Read and encode any existing tokens
    const tokenFiles = await fs.readdir(credentialsDir);
    const tokenData: Record<string, string> = {};

    for (const file of tokenFiles) {
      if (file.endsWith('.token.json')) {
        const email = file.replace('.token.json', '').replace(/-/g, '.');
        const tokenPath = path.join(credentialsDir, file);
        const token = await fs.readFile(tokenPath, 'utf8');
        tokenData[email] = Buffer.from(token).toString('base64');
      }
    }

    // Read existing .env if it exists
    const envPath = path.join(ROOT_DIR, '.env');
    let envContent = '';
    try {
      envContent = await fs.readFile(envPath, 'utf8');
      // Remove any existing Google credentials
      envContent = envContent
        .split('\n')
        .filter(line => !line.startsWith('GOOGLE_'))
        .join('\n');
      if (envContent && !envContent.endsWith('\n')) {
        envContent += '\n';
      }
    } catch {
      // If .env doesn't exist, start with empty content
    }

    // Add the new credentials
    envContent += `GOOGLE_CREDENTIALS=${credentialsBase64}\n`;
    
    // Add tokens for each account
    for (const [email, token] of Object.entries(tokenData)) {
      const safeEmail = email.replace(/[@.]/g, '_').toUpperCase();
      envContent += `GOOGLE_TOKEN_${safeEmail}=${token}\n`;
    }

    // Write to .env file
    await fs.writeFile(envPath, envContent);

    console.log('\n✅ Successfully configured Google environment:');
    console.log(`- Credentials loaded from: ${gauthPath}`);
    console.log(`- Tokens loaded: ${Object.keys(tokenData).length}`);
    console.log(`- Environment variables written to: ${envPath}`);
    
    if (Object.keys(tokenData).length === 0) {
      console.log('\nℹ️  No tokens found. Run authentication for each account to generate tokens.');
    }

  } catch (error) {
    console.error('\n❌ Setup failed:', error instanceof Error ? error.message : error);
    console.log('\nPlease ensure:');
    console.log('1. config/gauth.json exists with valid Google OAuth credentials');
    console.log('2. You have write permissions for the .env file');
    process.exit(1);
  }
}

setupGoogleEnv().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
