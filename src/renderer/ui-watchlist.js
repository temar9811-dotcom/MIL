// Watch list UI module: rows, live summaries, add button.
(function () {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function describeEntry(w, proximity) {
    const pilot = (w.characterName || '').trim();
    const ships = (w.shipClasses || []).map((s) => s.trim()).filter(Boolean);
    const extra = Number(w.extraRange) || 0;

    const who = pilot && ships.length ? `${pilot} in a ${ships.join(' / ')}`
      : pilot ? `pilot ${pilot}, any ship`
      : ships.length ? `any pilot in a ${ships.join(' / ')}`
      : 'any pilot, any ship';

    const where = extra > 0
      ? `${proximity + 1}-${proximity + extra} jumps out`
      : `any distance beyond ${proximity} jumps`;

    return `Soft-ping ${who}, ${where}`;
  }

  function rowHtml(w, i) {
    return `
      <input data-i="${i}" data-k="characterName" value="${escapeHtml(w.characterName || '')}" placeholder="Pilot (blank = any)" />
      <input data-i="${i}" data-k="shipClasses" value="${escapeHtml((w.shipClasses || []).join(', '))}" placeholder="Ship (blank = any)" />
      <input data-i="${i}" data-k="extraRange" type="number" min="0" step="1" value="${w.extraRange ?? 0}" title="Extra jumps on top of proximity (0 = unlimited)" />
      <label title="Enabled"><input data-i="${i}" data-k="enabled" type="checkbox" ${w.enabled ? 'checked' : ''} /></label>
    `;
  }

  function init(elements, getConfig) {
    const { container, addBtn } = elements;

    function render() {
      const config = getConfig();
      container.innerHTML = '';
      (config.watchList || []).forEach((w, i) => {
        const entry = document.createElement('div');
        entry.className = 'watch-entry';
        entry.innerHTML = `<div class="watch-row">${rowHtml(w, i)}</div>
          <div class="watch-summary">${escapeHtml(describeEntry(w, config.proximityRange ?? 0))}</div>`;
        container.appendChild(entry);
      });
    }

    function refreshSummaries(proximityOverride) {
      const config = getConfig();
      const prox = proximityOverride ?? config.proximityRange ?? 0;
      container.querySelectorAll('.watch-entry').forEach((el, i) => {
        const w = (config.watchList || [])[i];
        if (w) el.querySelector('.watch-summary').textContent = describeEntry(w, prox);
      });
    }

    container.addEventListener('input', (e) => {
      const i = +e.target.dataset.i;
      const k = e.target.dataset.k;
      const w = (getConfig().watchList || [])[i];
      if (!w) return;
      if (k === 'extraRange') w.extraRange = Math.max(0, +e.target.value || 0);
      else if (k === 'enabled') w.enabled = e.target.checked;
      else if (k === 'shipClasses') w.shipClasses = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
      else w[k] = e.target.value;
      refreshSummaries();
    });

    addBtn.addEventListener('click', () => {
      const config = getConfig();
      config.watchList = config.watchList || [];
      config.watchList.push({ characterName: '', shipClasses: [], extraRange: 0, enabled: true });
      render();
    });

    render();
    return { render, refreshSummaries };
  }

  window.uiWatchList = { init, describeEntry };
})();