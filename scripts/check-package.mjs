import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(command, ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (result.status !== 0) throw new Error(result.stderr || 'Could not inspect package.');
const [pack] = JSON.parse(result.stdout);
const files = pack.files.map((file) => file.path);
for (const file of ['dist/cli.cjs', 'dist/app/.next/BUILD_ID', 'dist/workers/backup.cjs', 'LICENSE', 'README.md', 'npm-shrinkwrap.json']) {
  if (!files.includes(file) || !existsSync(file)) throw new Error(`Missing release file: ${file}`);
}
const forbidden = files.filter((file) => /(^|\/)(node_modules|cache|\.git|\.data)\/|\.sqlite($|[.-])|\.db$|\.node$|\.tsbuildinfo$|\.map$|(^|\/)\.env($|\.)/.test(file));
if (forbidden.length) throw new Error(`Private or machine-specific files in package: ${forbidden.join(', ')}`);
console.log(`Package checked: ${files.length} files, ${(pack.size / 1024 / 1024).toFixed(1)} MB compressed. No database, private environment file or native binary included.`);
