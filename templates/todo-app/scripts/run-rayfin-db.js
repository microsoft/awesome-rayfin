#!/usr/bin/env node
import { spawn } from 'child_process';

console.log('🚀 Applying any database schema changes...');
const child = spawn('npm', ['run', 'rayfin:db'], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  if (code === 0) {
    process.exit(0);
  } else {
    console.error(
      '\n❌ Failed to run "npm run rayfin:db" that applies any database schema changes.'
    );
    console.error(
      '- See output above for details, and then please check the following:'
    );
    console.error('- Is your Rayfin service running?');
    console.error(
      '- Have you made any changes to a TypeScript model? If there are any changes that can cause data loss, you need to force apply the changes using the command `npx rayfin up db apply --force`.'
    );
    process.exit(code);
  }
});
