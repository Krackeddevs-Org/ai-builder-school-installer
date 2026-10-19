/* AI Builder School Setup — icon set.
   Inline SVG sprite, no emoji, no external requests.
   Stroke-based 24x24 icons drawn on a 1.75 stroke width for legibility at 16-20px. */
(function () {
  const ICONS = {
    check: '<polyline points="4.5 12.5 9.5 17.5 19.5 6.5"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    spinner: '<circle cx="12" cy="12" r="8" opacity=".28"/><path d="M20 12a8 8 0 0 0-8-8"/>',
    warn: '<path d="M12 4.5 21 19.5H3z"/><line x1="12" y1="10" x2="12" y2="14.2"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
    error: '<circle cx="12" cy="12" r="8.5"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>',
    dash: '<line x1="7" y1="12" x2="17" y2="12"/>',
    skip: '<path d="M5 5l7 7-7 7"/><path d="M12 5l7 7-7 7"/>',
    key: '<circle cx="8" cy="15" r="3.4"/><path d="M10.4 12.6 19 4"/><path d="M16 7l2.2 2.2"/><path d="M18.4 4.6 20.6 6.8"/>',
    code: '<polyline points="8.5 8 4.5 12 8.5 16"/><polyline points="15.5 8 19.5 12 15.5 16"/><line x1="13.5" y1="5" x2="10.5" y2="19"/>',
    git: '<circle cx="6.5" cy="6" r="2.6"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="17.5" cy="12" r="2.6"/><path d="M6.5 8.6v6.8"/><path d="M9.1 6h3.9a2 2 0 0 1 2 2v2.3"/>',
    node: '<path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6z"/><path d="M9.2 9.4h5.6v4.4a1.6 1.6 0 0 1-1.6 1.6h-2.4"/>',
    plug: '<path d="M9 3.5v5"/><path d="M15 3.5v5"/><path d="M6.5 8.5h11v2.2a5.5 5.5 0 0 1-5.5 5.5 5.5 5.5 0 0 1-5.5-5.5z"/><path d="M12 16.2v4.3"/>',
    rocket: '<path d="M13.5 4.2c3.2-.9 6.2-.3 6.3-.2.1.1.7 3.1-.2 6.3-.7 2.4-2.6 4.6-5 6.2l-3.8-3.8c1.6-2.4 3.8-4.3 6.2-5z"/><circle cx="15.6" cy="8.4" r="1.5"/><path d="M10.6 15.1 6.9 18.8"/><path d="M7.8 12.3 4.1 16c-.5-1.9.2-3.6 1.5-4.9 1.3-1.3 2.2-1.4 2.2-1.4z"/><path d="M12.6 17.2 9 20.9c1.9.5 3.6-.2 4.9-1.5 1.3-1.3 1.4-2.2 1.4-2.2z"/>',
    external: '<path d="M13.5 5.5h5v5"/><path d="M18.5 5.5 11 13"/><path d="M18.5 13.5v4a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1h4"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><polyline points="20 4.5 20 9.5 15 9.5"/>',
    folder: '<path d="M3.5 6.5a1 1 0 0 1 1-1h4.2l1.8 2.2h9a1 1 0 0 1 1 1v9.3a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r=".95" fill="currentColor" stroke="none"/>',
    sun: '<circle cx="12" cy="12" r="3.6"/><line x1="12" y1="2.8" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.2"/><line x1="2.8" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.2" y2="12"/><line x1="5.5" y1="5.5" x2="7.1" y2="7.1"/><line x1="16.9" y1="16.9" x2="18.5" y2="18.5"/><line x1="5.5" y1="18.5" x2="7.1" y2="16.9"/><line x1="16.9" y1="7.1" x2="18.5" y2="5.5"/>',
    moon: '<path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.6 8.6 0 1 0 20 14.2z"/>',
    monitor: '<rect x="3.2" y="4.8" width="17.6" height="11.4" rx="1.2"/><line x1="9" y1="19.4" x2="15" y2="19.4"/><line x1="12" y1="16.2" x2="12" y2="19.4"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.4"/><path d="M15.5 8.5v-2a1.4 1.4 0 0 0-1.4-1.4H5.9A1.4 1.4 0 0 0 4.5 6.5v8.2a1.4 1.4 0 0 0 1.4 1.4h2"/>',
    shield: '<path d="M12 3.4 19 6v5.3c0 4-2.9 7.4-7 9.3-4.1-1.9-7-5.3-7-9.3V6z"/><polyline points="9 12 11.2 14.2 15.2 10"/>'
  };

  function svg(name, size) {
    const d = ICONS[name];
    if (!d) return '';
    const s = size || 20;
    return (
      '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.75" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      d + '</svg>'
    );
  }

  window.Icons = { svg, names: Object.keys(ICONS) };

  // Replace any <i data-icon="name" data-size="20"></i> placeholder in the DOM.
  function hydrate(root) {
    (root || document).querySelectorAll('i[data-icon]').forEach(function (el) {
      el.outerHTML = svg(el.dataset.icon, parseInt(el.dataset.size || '20', 10));
    });
  }
  window.Icons.hydrate = hydrate;
})();