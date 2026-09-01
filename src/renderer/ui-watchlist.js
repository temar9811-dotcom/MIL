// MIL ui-watchlist v4 - per-row color picker
const watchListEl = document.getElementById('watch-list');
const addWatchBtn = document.getElementById('add-watch');

function makeRow(entry) {
  const row = document.createElement('div');
  row.className = 'watch-row';
  row.style.display = 'flex';
  row.style.gap = '6px';
  row.style.marginBottom = '6px';
  row.style.alignItems = 'center';

  const color = document.createElement('input');
  color.type = 'color';
  color.title = 'Alert color for this entry';
  color.style.width = '34px';
  color.style.height = '26px';
  color.style.padding = '0';
  color.style.border = 'none';
  color.style.flex = '0 0 auto';
  color.style.background = 'transparent';
  color.value = entry && entry.color ? entry.color : '#facc15';

  const pilot = document.createElement('input');
  pilot.type = 'text';
  pilot.placeholder = 'Pilot (blank = any)';
  pilot.style.flex = '1';
  pilot.value = entry && entry.pilot ? entry.pilot : '';

  const ship = document.createElement('input');
  ship.type = 'text';
  ship.placeholder = 'Ship (blank = any)';
  ship.style.flex = '1';
  ship.value = entry && entry.ship ? entry.ship : '';

  const extra = document.createElement('input');
  extra.type = 'number';
  extra.min = '0';
  extra.step = '1';
  extra.title = 'Extra jumps beyond proximity (0 = unlimited)';
  extra.style.width = '70px';
  extra.value = entry && entry.extraRange != null ? entry.extraRange : 0;

  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = 'X';
  del.addEventListener('click', () => row.remove());

  row.append(color, pilot, ship, extra, del);
  return row;
}

window.renderWatchList = (list) => {
  if (!watchListEl) return;
  watchListEl.innerHTML = '';
  (Array.isArray(list) ? list : []).forEach((e) => watchListEl.appendChild(makeRow(e)));
};

window.getWatchListData = () => {
  if (!watchListEl) return [];
  const rows = [...watchListEl.querySelectorAll('.watch-row')];
  const out = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll('input');
    const color = inputs[0].value || '#facc15';
    const pilot = inputs[1].value.trim();
    const ship = inputs[2].value.trim();
    const extraRange = parseInt(inputs[3].value, 10) || 0;
    // Footgun guard: blank+blank+0 would match everything everywhere - skip it
    if (!pilot && !ship && extraRange === 0) continue;
    out.push({ pilot, ship, extraRange, color });
  }
  return out;
};

if (addWatchBtn) {
  addWatchBtn.addEventListener('click', () => {
    if (watchListEl) watchListEl.appendChild(makeRow(null));
  });
}