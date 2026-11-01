import { spawnSync } from 'node:child_process';
const target = process.argv[2];
if (!['vercel', 'github-pages'].includes(target) || !process.env.npm_execpath) {
  throw new Error('Run npm run build:vercel or npm run build:github-pages.');
}
const env = { ...process.env, KAMPO_DEPLOY_TARGET: target };
for (const args of [[process.env.npm_execpath, 'run', 'build'], ['scripts/verify-build.mjs']]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
