const paths = {
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M21 14a9 9 0 0 1-11-11A9 9 0 1 0 21 14Z"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5zM3 12l9 5 9-5m-18 4 9 5 9-5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/><circle cx="12" cy="12" r="2.7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.5"/>',
  wave: '<path d="M2 8q2.5-3 5 0t5 0 5 0 5 0M2 13q2.5-3 5 0t5 0 5 0 5 0M2 18q2.5-3 5 0t5 0 5 0 5 0"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  radio:
    '<circle cx="12" cy="12" r="1.8"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9m9-9a6.4 6.4 0 0 1 0 9M4 4a11.3 11.3 0 0 0 0 16M20 4a11.3 11.3 0 0 1 0 16"/>',
  'arrow-up': '<path d="M7 17 17 7M8 7h9v9"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  anchor:
    '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M7 11h10M3 15c.5 4 4 6 9 6s8.5-2 9-6M3 15v4m18-4v4"/>',
  bridge: '<path d="M2 17h20M6 6v15m12-15v15M2 14l4-8q6 12 12 0l4 8"/>',
  refresh: '<path d="M20 8a8.5 8.5 0 1 0 .5 7M20 3v5h-5"/>'
}
export function icon(name) {
  return (
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">' +
    (paths[name] || '') +
    '</svg>'
  )
}
export function icons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon)
  })
}
