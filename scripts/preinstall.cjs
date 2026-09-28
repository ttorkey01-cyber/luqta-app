const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
for (const lockfile of ['package-lock.json', 'yarn.lock']) {
  fs.rmSync(path.join(workspaceRoot, lockfile), { force: true });
}

const userAgent = process.env.npm_config_user_agent || '';
const executable = process.env.npm_execpath || '';
const isPnpm =
  /(?:^|\s)pnpm\/\d/i.test(userAgent) ||
  /(?:^|[\\/])pnpm(?:\.cjs|\.mjs|\.js)?$/i.test(executable);

if (!isPnpm) {
  console.error('Use pnpm instead');
  process.exit(1);
}