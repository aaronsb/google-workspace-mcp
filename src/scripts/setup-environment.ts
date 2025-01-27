#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../..');

interface SetupCheck {
  path: string;
  type: 'file' | 'directory';
  example?: string;
  required: boolean;
}

const REQUIRED_ITEMS: SetupCheck[] = [
  {
    path: 'config',
    type: 'directory',
    required: true
  },
  {
    path: 'config/credentials',
    type: 'directory',
    required: true
  },
  {
    path: 'config/gauth.json',
    type: 'file',
    example: 'config/gauth.example.json',
    required: true
  },
  {
    path: 'config/accounts.json',
    type: 'file',
    example: 'config/accounts.example.json',
    required: true
  }
];

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function setupEnvironment(): Promise<void> {
  console.log('\n🔧 Setting up Google Workspace MCP Server environment...\n');
  
  for (const item of REQUIRED_ITEMS) {
    const fullPath = path.join(ROOT_DIR, item.path);
    const exists = await fileExists(fullPath);
    
    if (!exists) {
      if (item.type === 'directory') {
        console.log(`📁 Creating directory: ${item.path}`);
        await fs.mkdir(fullPath, { recursive: true });
      } else if (item.example) {
        const examplePath = path.join(ROOT_DIR, item.example);
        const exampleExists = await fileExists(examplePath);
        
        if (exampleExists) {
          console.log(`📄 Creating ${item.path} from example`);
          await fs.copyFile(examplePath, fullPath);
        } else if (item.required) {
          console.error(`❌ Error: Example file ${item.example} not found`);
          process.exit(1);
        }
      } else if (item.required) {
        console.error(`❌ Error: Required ${item.type} ${item.path} is missing`);
        process.exit(1);
      }
    } else {
      console.log(`✅ ${item.path} already exists`);
    }
  }

  console.log('\n✨ Environment setup complete!\n');
  console.log('Next steps:');
  console.log('1. Configure OAuth credentials in config/gauth.json');
  console.log('   - Create a project in Google Cloud Console');
  console.log('   - Enable Gmail API');
  console.log('   - Configure OAuth consent screen');
  console.log('   - Create OAuth 2.0 credentials');
  console.log('   - Copy credentials to config/gauth.json');
  console.log('\n2. Configure accounts in config/accounts.json');
  console.log('   - Add Google accounts you want to use');
  console.log('   - Set appropriate categories and descriptions');
  console.log('\n3. Run authentication for each account:');
  console.log('   ```');
  console.log('   npx ts-node src/scripts/setup-google-env.ts');
  console.log('   ```');
}

setupEnvironment().catch(error => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});
