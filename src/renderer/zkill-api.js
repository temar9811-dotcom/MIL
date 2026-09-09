// # FILE: src/renderer/zkill-api.js
// # VERSION: 3
/**
Zkillboard API wrapper with ESI name resolution.
Fetches the public killstream and resolves IDs (systems, ships, characters)
to human-readable names via ESI /universe/names/.
Exposes: window.zkillApi.fetchRecentKills()
*/
(function () {
var ZKILL_URL = 'https://zkillboard.com/api/kills/';
var ESI_NAMES = 'https://esi.evetech.net/latest/universe/names/?datasource=tranquility';
var nameCache = {};
var lastFetch = 0;
var MIN_INTERVAL = 10000;

function addId(arr, id) {
  if (id && id > 0 && arr.indexOf(id) === -1) arr.push(id);
}

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
          nameCache[data[j].id] = data[j].name;
        }
      }
    } catch (_) {}
  }
  var result = {};
  for (var k = 0; k < ids.length; k++) {
    result[ids[k]] = nameCache[ids[k]] || null;
  }
  return result;
}

function findFinalBlowCharId(attackers) {
  for (var i = 0; i < attackers.length; i++) {
    if (attackers[i].final_blow) return attackers[i].character_id || 0;
  }
  return 0;
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
    var ids = [];
    for (var i = 0; i < kills.length; i++) {
      var k = kills[i];
      var v = k.victim || {};
      addId(ids, k.solar_system_id);
      addId(ids, v.ship_type_id);
      addId(ids, v.character_id);
      addId(ids, findFinalBlowCharId(k.attackers || []));
    }
    var nameMap = await resolveNames(ids);
    var out = [];
    for (var j = 0; j < kills.length; j++) {
      var k = kills[j];
      var v = k.victim || {};
      var fbId = findFinalBlowCharId(k.attackers || []);
      out.push({
        id: k.killmail_id,
        time: k.killmail_time,
        system: nameMap[k.solar_system_id] || ('System-' + k.solar_system_id),
        shipType: nameMap[v.ship_type_id] || ('Type-' + (v.ship_type_id || '?')),
        victim: v.character_name || nameMap[v.character_id] || 'Unknown',
        finalBlowChar: nameMap[fbId] || 'Unknown',
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