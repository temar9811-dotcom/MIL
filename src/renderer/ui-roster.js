// MIL ui-roster v1 - character roster panel
const rosterList = document.getElementById('roster-list');

function renderRoster(chars) {
  if (!rosterList) return;
  rosterList.innerHTML = '';

  if (!chars || !chars.length) {
    const empty = document.createElement('div');
    empty.style.color = '#888';
    empty.style.fontSize = '0.85em';
    empty.textContent = 'No characters detected yet';
    rosterList.appendChild(empty);
    return;
  }

  for (const c of chars) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.padding = '3px 0';
    row.style.gap = '6px';

    const dot = document.createElement('span');
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.flex = '0 0 auto';
    dot.style.background = c.online ? '#4ade80' : '#64748b';

    const name = document.createElement('span');
    name.textContent = c.name;

    const sys = document.createElement('span');
    sys.style.marginLeft = 'auto';
    sys.style.color = '#888';
    sys.style.fontSize = '0.85em';
    if (c.online) {
      sys.textContent = c.system || 'unknown system';
    } else {
      const mins = c.lastSeen ? Math.max(0, Math.round((Date.now() - c.lastSeen) / 60000)) : '?';
      sys.textContent = `${c.system || 'unknown'} (${mins}m ago)`;
    }

    row.append(dot, name, sys);
    rosterList.appendChild(row);
  }
}

async function pollRoster() {
  if (!window.electronAPI || !window.electronAPI.getCharacters) return;
  try {
    const chars = await window.electronAPI.getCharacters();
    renderRoster(chars);
  } catch (_) { /* ignore poll errors */ }
}

pollRoster();
setInterval(pollRoster, 10000);