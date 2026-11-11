import { mkdir, readFile, writeFile, cp, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = process.cwd();
const output = path.join(root, '_site');
if (path.dirname(path.resolve(output)) !== path.resolve(root) || path.basename(output) !== '_site') throw new Error('Invalid build directory');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const assets = ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons'];
for (const asset of assets) await cp(path.join(root, asset), path.join(output, asset), { recursive: true });
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.sort((a,b)=>a.name.localeCompare(b.name)).map(e => e.isDirectory() ? files(path.join(directory,e.name)) : [path.join(directory,e.name)]));
  return paths.flat();
}
const hash = createHash('sha256');
for (const asset of assets) {
  const source = path.join(root, asset);
  for (const file of asset.includes('.') ? [source] : await files(source)) hash.update(await readFile(file));
}
const workerSource = await readFile(path.join(root, 'sw.js'), 'utf8');
hash.update(workerSource);
const worker = workerSource.replaceAll('__FORMA_CACHE_VERSION__', hash.digest('hex').slice(0,16));
await writeFile(path.join(output, 'sw.js'), worker);
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Built static app in _site/ (no personal data or server secrets).');
