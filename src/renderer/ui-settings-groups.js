// # FILE: src/renderer/ui-settings-groups.js
// # VERSION: 2

const groupsBox = document.getElementById('group-alerts');
let loadedGroups = [];

async function renderGroups(settings) {
  if (!groupsBox || !window.electronAPI || !window.electronAPI.getGroups) return;
  try {
    loadedGroups = await window.electronAPI.getGroups();
  } catch (_) { return; }
  const ga = (settings && settings.groupAlerts) || {};
  groupsBox.innerHTML = '';
  for (const g of loadedGroups) {
    const entry = ga[g.id] || {};
    const row = document.createElement('div');
    row.style.marginBottom = '10px';
    
    const line1 = document.createElement('div');
    line1.style.display = 'flex';
    line1.style.alignItems = 'center';
    line1.style.gap = '8px';
    
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `group-${g.id}`;
    cb.checked = !!entry.enabled;
    
    const dot = document.createElement('span');
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.flex = '0 0 auto';
    dot.style.background = g.color || '#888';
    
    const label = document.createElement('label');
    label.htmlFor = cb.id;
    label.style.flex = '1';
    label.textContent = g.label;
    
    line1.append(cb, dot, label);
    
    const line2 = document.createElement('div');
    line2.style.display = 'flex';
    line2.style.alignItems = 'center';
    line2.style.gap = '8px';
    line2.style.marginLeft = '24px';
    line2.style.marginTop = '4px';
    
    const range = document.createElement('input');
    range.type = 'number';
    range.min = '0';
    range.step = '1';
    range.style.width = '70px';
    range.id = `grouprange-${g.id}`;
    range.value = entry.range != null ? entry.range : 5;
    
    const unit = document.createElement('span');
    unit.style.color = '#888';
    unit.style.fontSize = '0.85em';
    unit.textContent = 'jumps beyond proximity';
    
    line2.append(range, unit);
    row.append(line1, line2);
    groupsBox.appendChild(row);
  }
}

function collectGroupAlerts() {
  const out = {};
  for (const g of loadedGroups) {
    const cb = document.getElementById(`group-${g.id}`);
    const range = document.getElementById(`grouprange-${g.id}`);
    out[g.id] = {
      enabled: cb ? cb.checked : false,
      range: range ? parseInt(range.value, 10) || 0 : 0,
    };
  }
  return out;
}

window.loadGroupSettings = (settings) => {
  renderGroups(settings);
};

window.collectGroupAlerts = collectGroupAlerts;