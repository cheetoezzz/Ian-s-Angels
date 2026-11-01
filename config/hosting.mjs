/** Shared by Astro, production-build validation and the browser test server. */
export function resolveHosting(env = process.env) {
  const target = env.KAMPO_DEPLOY_TARGET || (env.VERCEL === '1' ? 'vercel' : 'github-pages');
  if (!['vercel', 'github-pages'].includes(target)) {
    throw new Error('KAMPO_DEPLOY_TARGET must be vercel or github-pages.');
  }
  return target === 'vercel'
    ? { site: `https://${env.VERCEL_PROJECT_PRODUCTION_URL || 'kampo-delta.vercel.app'}`, base: '/' }
    : { site: 'https://cheetoezzz.github.io', base: '/Ian-s-Angels' };
}
