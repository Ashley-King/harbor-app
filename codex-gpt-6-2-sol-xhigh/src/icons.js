const paths = {
  radar: '<path d="M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5m-5 0 7-7"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.4" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>',
  moon: '<path d="M20.7 14.1A8.8 8.8 0 0 1 9.9 3.3 9 9 0 1 0 20.7 14.1Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M20 5v5h-5M4 19v-5h5m11-4A8 8 0 0 0 6 6m-2 8a8 8 0 0 0 14 4"/>',
  waves: '<path d="M2 8c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 13c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 18c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
  bridge: '<path d="M2 17h20M5 20V5m14 15V5M2 13c4 0 8-3 10-7 2 4 6 7 10 7m-12-4v8m4-8v8"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13m-4-9h8M3 13l1 4a10 10 0 0 0 16 0l1-4m-18 0 4 1m14-1-4 1"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  expand: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  panel: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M14 5v14m3-10h1m-1 3h1m-1 3h1"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function renderIcons(root = document) {
  for (const target of root.querySelectorAll('[data-icon]')) target.innerHTML = icon(target.dataset.icon);
}
