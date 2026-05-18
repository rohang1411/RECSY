/* eslint-disable */
import { execSync } from 'child_process';
import fs from 'fs';

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = { ...process.env };
for (const line of envFile.split('\n')) {
  if (line.trim() && !line.startsWith('#') && line.includes('=')) {
    const [k, ...v] = line.split('=');
    const val = v.join('=').trim().split(' #')[0].trim();
    env[k.trim()] = val;
  }
}

// remove the hack from test-db-parse.ts
const code = fs.readFileSync('test-db-parse.ts', 'utf-8');
const cleanCode = code.split('import { getDb }').slice(1).join('import { getDb }');
fs.writeFileSync('test-db-parse.ts', 'import { getDb }' + cleanCode);

execSync('npx tsx test-db-parse.ts', { env, stdio: 'inherit' });
