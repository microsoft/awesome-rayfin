// Assembles fabric-dist/ for Rayfin static hosting: the Airport IQ landing page
// plus the two views (Live Approach + DUS Live-Ops), each with its own data/.
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]tools$/, '');
const out = join(root, 'fabric-dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'index.html'), join(out, 'index.html'));
await cp(join(root, 'data-adapter.js'), join(out, 'data-adapter.js'));
await cp(join(root, 'views'), join(out, 'views'), { recursive: true });
console.log('Assembled fabric-dist/ (index.html + data-adapter.js + views/**)');
