import { assetUrl } from './paths';
export const iconNames = {
  queue:'house-door-fill', scoring:'clipboard2-data-fill', leaderboard:'trophy-fill',
  sessions:'calendar-week-fill', players:'people-fill', add:'person-plus-fill',
  data:'download', clock:'clock', arrow:'arrow-right', court:'grid',
  check:'check-lg', plus:'plus-lg', menu:'list', success:'check-circle-fill',
  error:'x-circle-fill', info:'info-circle-fill', warning:'exclamation-triangle-fill', trophy:'trophy-fill',
  link:'link-45deg',
} as const;
export type IconName = keyof typeof iconNames;
export function iconHref(name: string) {
  return assetUrl(`icons/ui.svg#${iconNames[name as IconName] || iconNames.queue}`);
}
export function renderIcon(name: string) {
  return `<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="${iconHref(name)}"></use></svg>`;
}
