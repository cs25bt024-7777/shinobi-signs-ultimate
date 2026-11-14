import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
ok(html.includes('src/main.js'), 'index loads the application module');
ok(html.includes('css/style.css'), 'index loads stylesheet');
const networkSource = fs.readFileSync(path.join(root, 'src/network/multiplayer.js'), 'utf8');
ok(networkSource.includes('peerjs@1.5.5/dist/peerjs.min.js'), 'PeerJS CDN is pinned and loaded on demand');
for (const id of ['create-room', 'join-room', 'join-code', 'room-code-value', 'network-status', 'leave-room']) {
  ok(html.includes(`id="${id}"`), `multiplayer control ${id} exists`);
}
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (full.endsWith('.js')) files.push(full);
  }
}
walk(path.join(root, 'src'));
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), match[1]);
    ok(fs.existsSync(target), `${path.relative(root, file)} imports ${match[1]}`);
  }
}
console.log(`Project integrity: ${checks}/${checks} passed (${files.length} JS modules inspected)`);
