// MIL ui-watchlist v3 - ignores accidental fully-blank rows on save
const watchListEl = document.getElementById('watch-list');
const addWatchBtn = document.getElementById('add-watch');

function makeRow(entry) {
  const row = document.createElement('div');
  row.className = 'watch-row';
  row.style.display = 'flex';
  row.style.gap = '6px';
  row.style.marginBottom = '6px';

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

  row.append(pilot, ship, extra, del);
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
    const pilot = inputs[0].value.trim();
    const ship = inputs[1].value.trim();
    const extraRange = parseInt(inputs[2].value, 10) || 0;
    // Footgun guard: blank+blank+0 would match everything everywhere - skip it
    if (!pilot && !ship && extraRange === 0) continue;
    out.push({ pilot, ship, extraRange });
  }
  return out;
};

if (addWatchBtn) {
  addWatchBtn.addEventListener('click', () => {
    if (watchListEl) watchListEl.appendChild(makeRow(null));
  });
}