// Copies the app's public files into dist/ (what the Worker serves). Everything else in the repo
// (server code, tests, the Mac app) stays private.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), '..');
const dist = path.join(root, 'dist');
const PUBLIC = [
  'index.html', 'styles.css', 'app.js', 'xlsx.js', 'ics.js', 'sw.js', 'manifest.webmanifest',
  'icons', 'widget/commitments-widget.js', 'vendor', 'privacy.html', 'terms.html', 'legal.css',
];

fs.rmSync(dist, { recursive: true, force: true });
for (const item of PUBLIC) {
  fs.cpSync(path.join(root, item), path.join(dist, item), { recursive: true });
}
fs.writeFileSync(path.join(dist, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: same-origin',
  '/sw.js',
  '  Cache-Control: no-cache',
  '/index.html',
  '  Cache-Control: no-cache',
  '',
].join('\n'));
console.log(`Built dist/ (${PUBLIC.length} items)`);
