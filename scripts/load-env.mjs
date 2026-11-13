import fs from 'node:fs';

for (const file of ['.env.local', '.env']) {
  if (fs.existsSync(file)) {
    try {
      process.loadEnvFile(file);
      break;
    } catch {
      // Ignore parse/read errors
    }
  }
}
