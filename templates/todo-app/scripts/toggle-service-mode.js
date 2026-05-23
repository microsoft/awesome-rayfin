/**
 * Helper script to toggle between mock and Rayfin service modes
 * Updates the .env.local file to set VITE_SERVICE_MODE
 * Run this script before starting the development server
 */

import fs from 'fs';
import path from 'path';

const envLocalPath = path.resolve('./.env.local');

// Read the current .env.local file
let envContent = '';
if (fs.existsSync(envLocalPath)) {
  envContent = fs.readFileSync(envLocalPath, 'utf-8');
}

// Determine the desired mode
const requestedMode = process.argv[2];
if (!requestedMode || !['mock', 'rayfin'].includes(requestedMode)) {
  console.error(
    '❌ Invalid mode. Use: node scripts/toggle-service-mode.js [mock|rayfin]'
  );
  process.exit(1);
}

// Update or add the VITE_SERVICE_MODE line
const serviceModeRegex = /^VITE_SERVICE_MODE=.*$/m;
const newServiceModeLine = `VITE_SERVICE_MODE=${requestedMode}`;

if (serviceModeRegex.test(envContent)) {
  // Replace existing line
  envContent = envContent.replace(serviceModeRegex, newServiceModeLine);
} else {
  // Add new line
  envContent = envContent.trim();
  if (envContent) {
    envContent += '\n';
  }
  envContent += `# Service mode override\n${newServiceModeLine}\n`;
}

// Write the updated content back to the file
fs.writeFileSync(envLocalPath, envContent);

console.log(`✅ Service mode set to '${requestedMode}' in .env.local`);
console.log(
  `🚀 Now you can run 'npm run dev' to start the development server in ${requestedMode} mode.`
);
console.log(
  `💡 Tip: You can also set VITE_RAYFIN_API_URL in .env.local to customize the API endpoint.`
);
