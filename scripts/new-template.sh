#!/usr/bin/env bash
#
# Creates a new template in the gallery with the correct structure.
#
# Usage:
#   ./scripts/new-template.sh <name> "<Display Name>" "<description>"
#
# Example:
#   ./scripts/new-template.sh inventory-tracker "Inventory Tracker" "Track inventory with barcode scanning and Rayfin data"

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ $# -lt 3 ]; then
  echo "Usage: $0 <name> \"<Display Name>\" \"<description>\""
  echo ""
  echo "  name          kebab-case template name (e.g., inventory-tracker)"
  echo "  Display Name  human-readable name (e.g., Inventory Tracker)"
  echo "  description   one-line description"
  exit 1
fi

NAME="$1"
DISPLAY_NAME="$2"
DESCRIPTION="$3"
TEMPLATE_DIR="$ROOT/templates/$NAME"

if [ -d "$TEMPLATE_DIR" ]; then
  echo "❌ templates/$NAME already exists"
  exit 1
fi

# Validate kebab-case
if [[ ! "$NAME" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]]; then
  echo "❌ Template name must be kebab-case (e.g., my-app)"
  exit 1
fi

echo "📦 Creating template: $NAME"
mkdir -p "$TEMPLATE_DIR/src/pages" \
         "$TEMPLATE_DIR/src/components" \
         "$TEMPLATE_DIR/src/hooks" \
         "$TEMPLATE_DIR/src/services" \
         "$TEMPLATE_DIR/src/assets" \
         "$TEMPLATE_DIR/src/__tests__" \
         "$TEMPLATE_DIR/rayfin/data"

# ── package.json ──────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/package.json" << PKGJSON
{
  "name": "$NAME",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "template": {
    "name": "$NAME",
    "displayName": "$DISPLAY_NAME",
    "description": "$DESCRIPTION"
  },
  "scripts": {
    "predev": "rayfin env --framework vite",
    "prebuild": "rayfin env --framework vite",
    "dev": "rayfin up --exclude-services staticHosting && vite",
    "build": "tsc -b && vite build",
    "build:fabric": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "rayfin:up": "rayfin up"
  },
  "dependencies": {
    "@microsoft/rayfin-auth-provider-fabric": "^1.32.0",
    "@microsoft/rayfin-client": "^1.32.0",
    "@microsoft/rayfin-core": "^1.32.0",
    "@microsoft/rayfin-data": "^1.32.0",
    "@tailwindcss/vite": "^4.1.11",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.21.0",
    "@microsoft/rayfin-cli": "^1.23.0",
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.10",
    "@types/react-dom": "^19.0.4",
    "@vitejs/plugin-react-swc": "^4.2.2",
    "eslint": "^9.28.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.19",
    "globals": "^16.0.0",
    "jsdom": "^24.1.0",
    "tailwindcss": "^4.1.11",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.38.0",
    "vite": "^7.3.2",
    "vitest": "^3.2.4"
  }
}
PKGJSON

# ── manifest.json ─────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/manifest.json" << MANIFEST
{
  "templateId": "$NAME",
  "icon": "$NAME",
  "services": {
    "auth": true,
    "data": true,
    "storage": false,
    "staticHosting": true
  },
  "hasDabSchema": false,
  "tokens": [
    "__RAYFIN_API_URL__",
    "__RAYFIN_PK__",
    "__FABRIC_ITEM_ID__",
    "__FABRIC_WORKSPACE_ID__",
    "__FABRIC_PORTAL_URL__"
  ]
}
MANIFEST

# ── README.md ─────────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/README.md" << README
# $DISPLAY_NAME

$DESCRIPTION

## Getting started

\`\`\`bash
# Deploy app to Fabric and start the local dev server
npm run dev
\`\`\`

Open [http://localhost:5173](http://localhost:5173) to view the app.

## Project structure

\`\`\`text
├── rayfin/
│   ├── rayfin.yml          # Fabric service configuration
│   └── data/
│       └── schema.ts       # Data schema — add your entities here
├── src/
│   ├── main.tsx            # Entry point + Rayfin client bootstrap
│   ├── App.tsx             # Routes and auth gate
│   ├── components/         # Shared UI components
│   ├── hooks/              # React hooks
│   ├── pages/              # Page components
│   └── services/           # Auth and data services
└── package.json
\`\`\`

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Deploy app to Fabric and start local dev server |
| \`npm run build\` | Production build |
| \`npm run build:fabric\` | Build for Fabric deployment |
| \`npm run lint\` | Lint with ESLint |
| \`npm run test\` | Run unit tests with Vitest |
| \`npm run rayfin:up\` | Deploy app to Fabric (no local dev server) |
README

# ── rayfin/rayfin.yml ─────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/rayfin/rayfin.yml" << RAYFINYML
id: $NAME
name: $NAME
version: 1.0.0
services:
  auth:
    enabled: true
    fabric:
      enabled: true
    password:
      enabled: true
    allowedRedirectUris:
      - http://localhost:5173
  data:
    enabled: true
    dialect: mssql
  staticHosting:
    enabled: true
    folder: dist
    buildCommand: npm run build:fabric
    indexDocument: index.html
RAYFINYML

# ── rayfin/data/schema.ts ────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/rayfin/data/schema.ts" << 'SCHEMA'
// Add your entity imports here
// import { MyEntity } from './MyEntity';

export type BlankAppSchema = Record<string, never>;

export const schema = [];
SCHEMA

# ── rayfin/tsconfig.json ─────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/rayfin/tsconfig.json" << 'RAYFINTSCONFIG'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "ESNext.Decorators"],
    "experimentalDecorators": false,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["data"]
}
RAYFINTSCONFIG

# ── tsconfig.json ─────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/tsconfig.json" << 'ROOTTSCONFIG'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "ESNext.Decorators"],
    "jsx": "react-jsx",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "noEmit": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"],
  "references": [{ "path": "./rayfin" }]
}
ROOTTSCONFIG

# ── vite.config.ts ────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/vite.config.ts" << 'VITECONFIG'
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
});
VITECONFIG

# ── vitest.config.ts ──────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/vitest.config.ts" << 'VITESTCONFIG'
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
});
VITESTCONFIG

# ── src/__tests__/setup.ts ────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/src/__tests__/setup.ts" << 'TESTSETUP'
import '@testing-library/jest-dom';
TESTSETUP

# ── index.html ────────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/index.html" << INDEXHTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>$DISPLAY_NAME</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
INDEXHTML

# ── src/main.css ──────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/src/main.css" << 'MAINCSS'
@import "tailwindcss";
MAINCSS

# ── src/vite-env.d.ts ────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/src/vite-env.d.ts" << 'VITEENV'
/// <reference types="vite/client" />
VITEENV

# ── src/main.tsx ──────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/src/main.tsx" << 'MAINTSX'
import { createRoot } from 'react-dom/client';

import './main.css';

function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <h1 className="text-3xl font-bold">Hello from your new template!</h1>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
MAINTSX

# ── eslint.config.js ──────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/eslint.config.js" << 'ESLINTCONFIG'
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
ESLINTCONFIG

# ── .gitignore ────────────────────────────────────────────────────────────────
cat > "$TEMPLATE_DIR/.gitignore" << 'GITIGNORE'
node_modules/
dist/
*.tsbuildinfo
.env
.env.local
.env.*.local
rayfin/.temp/
rayfin/.deployments.json
.DS_Store
GITIGNORE

echo ""
echo "✅ Template created at templates/$NAME"
echo ""
echo "Next steps:"
echo "  1. Customize src/main.tsx and add your pages/components"
echo "  2. Add data entities in rayfin/data/"
echo "  3. Run: node scripts/generate-manifest.mjs"
echo "  4. Test: rayfin init -t . --template-name \"$DISPLAY_NAME\""
