export const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
export function pageUrl(page = 'index', query = ''): string {
  return `${base}${page === 'index' ? 'index.html' : page + '.html'}${query}`;
}
export function assetUrl(path: string): string {
  return `${base}${path.replace(/^\//, '')}`;
}
