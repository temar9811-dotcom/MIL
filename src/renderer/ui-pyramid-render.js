// MIL ui-pyramid-render v1 - pyramid drawing (split from ui-pyramid)
(function () {
  const MIN_TILE = 12;
  const GAP = 2;
  const SHADE_ODD = '#465671';
  const SHADE_EVEN = '#35425a';

  const tip = document.getElementById('pyramid-tip');

  function shadeFor(jumps) {
    return jumps % 2 === 1 ? SHADE_ODD : SHADE_EVEN;
  }

  function showTip(e, raw) {
    tip.innerHTML = '';
    let lines = null;
    try { lines = JSON.parse(raw); } catch (_) { lines = [raw]; }
    lines.forEach((text, i) => {
      const d = document.createElement('div');
      d.textContent = text;
      if (i === 0) {
        d.style.fontWeight = '600';
      } else {
        d.style.color = '#94a3b8';
        d.style.fontSize = '11px';
        d.style.marginTop = '2px';
      }
      tip.appendChild(d);
    });
    tip.style.display = 'block';

    const pad = 12;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    if (x + w > window.innerWidth - 4) x = window.innerWidth - w - 4;
    if (y + h > window.innerHeight - 4) y = Math.max(4, e.clientY - h - pad);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function hideTip() {
    tip.style.display = 'none';
  }

  function divider(color, label) {
    const d = document.createElement('div');
    d.style.borderTop = `2px solid ${color}`;
    d.style.margin = '8px 0 6px';
    d.style.position = 'relative';
    const s = document.createElement('span');
    s.style.position = 'absolute';
    s.style.right = '0';
    s.style.top = '-16px';
    s.style.color = color;
    s.style.fontSize = '11px';
    s.textContent = label;
    d.appendChild(s);
    return d;
  }

  function buildLayout(box, data, tileEls) {
    box.innerHTML = '';
    tileEls.clear();
    const frag = document.createDocumentFragment();

    const maxJumps = data.softMax || (data.rows.length ? data.rows[data.rows.length - 1].jumps : 1) || 1;

    let base = 320;
    for (const row of data.rows) {
      base = Math.max(base, row.systems.length * (MIN_TILE + GAP));
    }

    const bounds = new Map();
    const addBound = (rowJ, color, label) => {
      if (!rowJ || rowJ < 1) return;
      const arr = bounds.get(rowJ) || [];
      arr.push({ color, label });
      bounds.set(rowJ, arr);
    };
    if (data.proximity > 0) addBound(data.proximity, '#ef4444', `RED ≤ ${data.proximity}j`);
    if (data.cynoMax > data.proximity) addBound(data.cynoMax, '#22d3ee', `CYNO ≤ ${data.cynoMax}j`);
    addBound(data.softMax, '#f59e0b', `SOFT ≤ ${data.softMax}j`);

    for (const row of data.rows) {
      const line = document.createElement('div');
      line.style.display = 'flex';
      line.style.alignItems = 'flex-start';
      line.style.gap = '6px';
      line.style.marginBottom = '2px';

      const lab = document.createElement('span');
      lab.style.width = '36px';
      lab.style.flex = '0 0 auto';
      lab.style.color = '#888';
      lab.style.fontSize = '11px';
      lab.style.lineHeight = '18px';
      lab.textContent = row.jumps === 0 ? 'YOU' : `${row.jumps}j`;
      line.appendChild(lab);

      const wrap = document.createElement('div');
      wrap.style.flex = '1';
      wrap.style.display = 'flex';
      wrap.style.justifyContent = 'center';

      const cells = document.createElement('div');
      const natural = row.systems.length * (MIN_TILE + GAP);
      const fraction = (row.jumps + 1) / (maxJumps + 1);
      const slice = Math.max(natural, Math.round(base * fraction));
      cells.style.width = `${slice}px`;
      cells.style.display = 'flex';
      cells.style.gap = `${GAP}px`;

      for (const s of row.systems) {
        const t = document.createElement('div');
        t.style.flex = '1 1 0';
        t.style.minWidth = '8px';
        t.style.height = '18px';
        t.style.borderRadius = '3px';
        t.style.background = shadeFor(row.jumps);
        t.dataset.name = s.n;
        t.dataset.tip = s.t;
        t.addEventListener('mousemove', (e) => showTip(e, t.dataset.tip || s.n));
        t.addEventListener('mouseleave', hideTip);
        cells.appendChild(t);
        tileEls.set(s.n, t);
      }

      wrap.appendChild(cells);
      line.appendChild(wrap);
      frag.appendChild(line);

      const b = bounds.get(row.jumps);
      if (b) {
        frag.appendChild(divider(b[b.length - 1].color, b.map((x) => x.label).join(' · ')));
      }
    }

    if (data.farAlts && data.farAlts.length) {
      const head = document.createElement('div');
      head.style.color = '#888';
      head.style.fontSize = '11px';
      head.style.margin = '12px 0 4px';
      head.textContent = 'BEYOND 20 JUMPS';
      frag.appendChild(head);

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.flexWrap = 'wrap';
      row.style.gap = '6px';
      for (const a of data.farAlts) {
        const chip = document.createElement('span');
        chip.style.border = '1px solid #22c55e';
        chip.style.color = '#4ade80';
        chip.style.borderRadius = '4px';
        chip.style.padding = '2px 6px';
        chip.style.fontSize = '11px';
        chip.textContent = `${a.name} · ${a.system}`;
        row.appendChild(chip);
      }
      frag.appendChild(row);
    }

    box.appendChild(frag);
  }

  function paint(data, tileEls) {
    for (const row of data.rows) {
      const shade = shadeFor(row.jumps);
      for (const s of row.systems) {
        const t = tileEls.get(s.n);
        if (!t) continue;
        t.dataset.tip = s.t;
        if (s.c) {
          t.style.background = s.c;
          t.style.boxShadow = `0 0 6px ${s.c}`;
        } else {
          t.style.background = shade;
          t.style.boxShadow = 'none';
        }
      }
    }

    for (const a of (data.alts || [])) {
      const t = tileEls.get(a.system);
      if (!t) continue;
      const lit = data.rows.some((r) => r.systems.some((s) => s.n === a.system && s.c));
      if (!lit) {
        t.style.background = '#22c55e';
        t.style.boxShadow = '0 0 6px #22c55e';
      }
      t.dataset.tip = JSON.stringify([`${a.name} · ${a.system} (alt)`, 'online']);
    }

    if (data.you && tileEls.has(data.you)) {
      const t = tileEls.get(data.you);
      t.style.background = '#22c55e';
      t.style.boxShadow = '0 0 6px #22c55e';
      t.dataset.tip = JSON.stringify([`${data.youName || 'YOU'} · ${data.you}`]);
    }
  }

  function autosize(box) {
    if (!window.electronAPI || !window.electronAPI.resizePyramid) return;
    const prev = box.style.width;
    box.style.width = 'max-content';
    const w = box.scrollWidth;
    const h = box.scrollHeight;
    box.style.width = prev;
    window.electronAPI.resizePyramid({ w, h });
  }

  window.PyrRender = { showTip, hideTip, buildLayout, paint, autosize };
})();