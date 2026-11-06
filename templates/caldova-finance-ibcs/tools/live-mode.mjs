// Switch the project to LIVE connector mode (README "Live connector mode").
//
//   node tools/live-mode.mjs enable    declare the `statements` semantic-model connector in rayfin/rayfin.yml
//   node tools/live-mode.mjs disable   remove it again (back to the baked snapshot)
//
// Then build and deploy with VITE_LIVE_MODEL=true, ideally as a separate item:
//   VITE_LIVE_MODEL=true npx rayfin up --env-file rayfin/live.env --item-name "Caldova Finance (live)"
//
// ⚠️ A deployed app with a fabric-semanticmodel connector opens only for its owner (the connector runs as a
// delegated User Data Function; Rayfin 1.36). Keep the default deployment on the baked snapshot.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['enable', 'disable'].includes(mode)) throw new Error('usage: node tools/live-mode.mjs enable|disable');

const target = existsSync(resolve(ROOT, 'tools/fabric/target.json')) ? JSON.parse(readFileSync(resolve(ROOT, 'tools/fabric/target.json'), 'utf-8')) : {};
const ws = process.env.FABRIC_WORKSPACE_ID ?? target.workspaceId;
const model = process.env.FABRIC_MODEL_ID ?? target.modelId;

const rayfin = (args) => {
  const [cmd, pre] = process.platform === 'win32' ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npx', 'rayfin']] : ['npx', ['rayfin']];
  execFileSync(cmd, [...pre, ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, RAYFIN_TELEMETRY_OPTOUT: '1' } });
};

if (mode === 'enable') {
  if (!ws || !model) throw new Error('set FABRIC_WORKSPACE_ID and FABRIC_MODEL_ID, or fill tools/fabric/target.json');
  rayfin(['connector', 'add', '--type', 'fabric-semanticmodel', '--workspace-id', ws, '--item-id', model, '--name', 'statements', '--yes']);
  console.log('\nLive mode declared. Build and deploy with VITE_LIVE_MODEL=true (see the header of this file).');
} else {
  rayfin(['connector', 'remove', 'statements', '--yes']);
  console.log('\nLive mode removed: the app reads the baked snapshot again.');
}
