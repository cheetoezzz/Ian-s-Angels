// These IDs are the existing HTML control contract, now owned by Astro components.
export function byId(id: string) {
  return document.getElementById(id) as HTMLInputElement & HTMLDialogElement & HTMLSelectElement;
}
