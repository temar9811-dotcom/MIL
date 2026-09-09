// # FILE: src/renderer/zkill-api.js
// # VERSION: 1

/**
 * Zkillboard API wrapper with ESI system-name resolution.
 * Fetches the public killstream and resolves solar_system_id
 * to human-readable names via ESI /universe/names/.
 * Exposes: window.zkillApi.fetchRecentKills()
 */
(function () {
  var ZKILL_URL = 'https://zkillboard.com/api/kills/';
  var ESI_NAMES = 'https://esi.evetech.net/latest/universe/names/?datasource=tranquility';
  var nameCache = {};
  var lastFetch = 0;
  var MIN_INTERVAL = 10000;

  async function resolveNames(ids) {
    var uncached = [];
    for (var i = 0; i < ids.length; i++) {
      if (!nameCache[ids[i]]) uncached.push(ids[i]);
    }
    if (uncached.length > 0) {
      try {
        var resp = await fetch(ESI_NAMES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(uncached)
        });
        if (resp.ok) {
          var data = await resp.json();
          for (var j = 0; j < data.length; j++) {
            if (data[j].category === 'solar_system') {
              nameCache[data[j].id] = data[j].name;
            }
          }
        }
      } catch (_) { /* ESI failed, fall back to IDs */ }
    }
    var result = {};
    for (var k = 0; k < ids.length; k++) {
      result[ids[k]] = nameCache[ids[k]] || ('System-' + ids[k]);
    }
    return result;
  }

  async function fetchRecentKills() {
    var now = Date.now();
    if (now - lastFetch < MIN_INTERVAL) return [];
    lastFetch = now;
    try {
      var resp = await fetch(ZKILL_URL, {
        headers: { 'Accept': 'application/json' }
      });
      if (!resp.ok) return [];
      var kills = await resp.json();
      var sysIds = [];
      for (var i = 0; i < kills.length; i++) {
        var sid = kills[i].solar_system_id;
        if (sid && sysIds.indexOf(sid) === -1) sysIds.push(sid);
      }
      var nameMap = await resolveNames(sysIds);
      var out = [];
      for (var j = 0; j < kills.length; j++) {
        var k = kills[j];
        var v = k.victim || {};
        out.push({
          id: k.killmail_id,
          time: k.killmail_time,
          system: nameMap[k.solar_system_id] || 'Unknown',
          victim: v.character_name || 'Unknown',
          attackers: (k.attackers || []).length,
          url: 'https://zkillboard.com/kill/' + k.killmail_id + '/'
        });
      }
      return out;
    } catch (err) {
      if (typeof window.appendDebug === 'function') {
        window.appendDebug('WARN', 'Zkill fetch failed: ' + err.message);
      }
      return [];
    }
  }

  window.zkillApi = { fetchRecentKills: fetchRecentKills };
})();