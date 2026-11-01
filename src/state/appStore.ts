import type { AppData } from '../types';

export const STORAGE_KEY = 'pickleball_queue_data';
const revisions = new WeakMap<object, string | null>();
const subscribers = new Set<(data: AppData | null) => void>();

export function readStoredData(normalize: (raw: any) => AppData, defaults: () => AppData): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  const data = raw ? normalize(JSON.parse(raw)) : defaults();
  revisions.set(data, raw);
  return data;
}

export function writeStoredData(data: AppData): boolean {
  const current = localStorage.getItem(STORAGE_KEY);
  if (revisions.has(data) && revisions.get(data) !== current) {
    throw new Error('Data changed in another tab. Review the latest state and try again.');
  }
  const serialized = JSON.stringify(data);
  localStorage.setItem(STORAGE_KEY, serialized);
  revisions.set(data, serialized);
  subscribers.forEach(listener => listener(data));
  return true;
}

export function subscribe(listener: (data: AppData | null) => void) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

// storage events arrive only from other documents. Reads always use localStorage.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === null) subscribers.forEach(listener => listener(null));
  });
}
