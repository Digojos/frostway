export const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Shows one panel over the game (hiding the other panels and the dim overlay), or none. */
export function showPanel(id: string | null): void {
  const overlay = byId('overlay');
  overlay.classList.toggle('hidden', id === null);
  for (const panel of overlay.querySelectorAll<HTMLElement>(':scope > section')) panel.classList.toggle('hidden', panel.id !== id);
}
