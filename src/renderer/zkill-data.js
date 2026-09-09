// # FILE: src/renderer/zkill-data.js
// # VERSION: 1

/**
 * Renderer-side jump-distance calculator.
 * Fetches adjacency map from main process once at startup,
 * then exposes systemsWithin() so the renderer can filter
 * kills locally without repeated IPC calls.
 */
(function () {
  var adjacency = new Map();
  var loaded = false;

  function buildAdjacency(raw) {
    adjacency.clear();
    if (!raw || typeof raw !== 'object') return;
    for (var name in raw) {
      if (!raw.hasOwnProperty(name)) continue;
      if (!adjacency.has(name)) adjacency.set(name, new Set());
      var neighbors = raw[name];
      if (!Array.isArray(neighbors)) continue;
      for (var i = 0; i < neighbors.length; i++) {
        var n = neighbors[i];
        adjacency.get(name).add(n);
        if (!adjacency.has(n)) adjacency.set(n, new Set());
        adjacency.get(n).add(name);
      }
    }
    loaded = true;
  }

  function systemsWithin(systemNames, maxJumps) {
    var out = new Map();
    if (!loaded || !systemNames || !maxJumps) return out;
    var frontier = [];
    for (var i = 0; i < systemNames.length; i++) {
      var s = systemNames[i];
      if (adjacency.has(s) && !out.has(s)) {
        out.set(s, 0);
        frontier.push(s);
      }
    }
    var depth = 0;
    while (frontier.length && depth < maxJumps) {
      depth++;
      var next = [];
      for (var j = 0; j < frontier.length; j++) {
        var nb = adjacency.get(frontier[j]);
        if (!nb) continue;
        nb.forEach(function (n) {
          if (!out.has(n)) { out.set(n, depth); next.push(n); }
        });
      }
      frontier = next;
    }
    return out;
  }

  async function init() {
    try {
      if (!window.electronAPI || !window.electronAPI.getSystemsAdjacency) return;
      var raw = await window.electronAPI.getSystemsAdjacency();
      buildAdjacency(raw);
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('INFO', 'Zkill: adjacency loaded (' + adjacency.size + ' systems)');
      }
    } catch (err) {
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('WARN', 'Zkill: adjacency load failed: ' + err.message);
      }
    }
  }

  window.zkillData = {
    systemsWithin: systemsWithin,
    isLoaded: function () { return loaded; },
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();