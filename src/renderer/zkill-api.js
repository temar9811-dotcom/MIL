// # FILE: src/renderer/zkill-api.js
// # VERSION: 4
/**
Zkillboard API wrapper with ESI name resolution.
Fetches the public killstream and resolves IDs (systems, characters, ships, corps)
to human-readable names via ESI /universe/names/.
Exposes: window.zkillApi.fetchRecentKills()
*/
(function () {
var ZKILL_URL = 'https://zkillboard.com/api/kills/';
var ESI_NAMES = 'https://esi.evetech.net/latest/universe/names/?datasource=tranquility';
var nameCache = {};
var lastFetch = 0;
var MIN_INTERVAL = 10000;

function log(level, msg) {
    if (typeof window.appendDebug === 'function') window.appendDebug(level, 'Zkill-API: ' + msg);
}

function addId(arr, id) {
    if (id && id > 0 && arr.indexOf(id) === -1) arr.push(id);
}

async function resolveNames(ids) {
    var uncached = [];
    for (var i = 0; i < ids.length; i++) {
        if (!nameCache[ids[i]]) uncached.push(ids[i]);
    }
    if (uncached.length > 0) {
        log('DEBUG', 'Resolving ' + uncached.length + ' uncached ESI IDs...');
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
                log('INFO', 'Successfully resolved ' + data.length + ' names from ESI.');
            } else {
                log('WARN', 'ESI name resolution failed with status: ' + resp.status);
            }
        } catch (err) {
            log('ERROR', 'ESI name resolution exception: ' + err.message);
        }
    } else {
        log('DEBUG', 'All ' + ids.length + ' IDs already cached.');
    }
    var result = {};
    for (var k = 0; k < ids.length; k++) {
        result[ids[k]] = nameCache[ids[k]] || null;
    }
    return result;
}

function findFinalBlow(attackers) {
    for (var i = 0; i < attackers.length; i++) {
        if (attackers[i].final_blow) return attackers[i];
    }
    return null;
}

async function fetchRecentKills() {
    var now = Date.now();
    if (now - lastFetch < MIN_INTERVAL) {
        log('DEBUG', 'Fetch skipped: rate limit cooldown active.');
        return [];
    }
    lastFetch = now;
    log('INFO', 'Fetching recent kills from zKillboard...');
    try {
        var resp = await fetch(ZKILL_URL, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) {
            log('WARN', 'zKillboard API returned status: ' + resp.status);
            return [];
        }
        var kills = await resp.json();
        log('INFO', 'Received ' + kills.length + ' raw kills from zKillboard.');
        
        var ids = [];
        for (var i = 0; i < kills.length; i++) {
            var k = kills[i];
            var v = k.victim || {};
            var fb = findFinalBlow(k.attackers || []);
            addId(ids, k.solar_system_id);
            addId(ids, v.character_id);
            addId(ids, v.ship_type_id);
            if (fb) {
                addId(ids, fb.character_id);
                addId(ids, fb.ship_type_id);
                addId(ids, fb.corporation_id);
            }
        }
        
        var nameMap = await resolveNames(ids);
        var out = [];
        for (var j = 0; j < kills.length; j++) {
            var k = kills[j];
            var v = k.victim || {};
            var fb = findFinalBlow(k.attackers || []);
            out.push({
                id: k.killmail_id,
                time: k.killmail_time,
                system: nameMap[k.solar_system_id] || 'Unknown',
                victim: v.character_name || nameMap[v.character_id] || 'Unknown',
                victimShip: nameMap[v.ship_type_id] || 'Unknown Ship', // Added for table layout
                finalBlowChar: fb ? (nameMap[fb.character_id] || 'Unknown') : 'Unknown',
                finalBlowShip: fb ? (nameMap[fb.ship_type_id] || 'Unknown Ship') : 'Unknown Ship',
                finalBlowCorp: fb ? (nameMap[fb.corporation_id] || 'Unknown Corp') : 'Unknown Corp',
                attackers: (k.attackers || []).length,
                url: 'https://zkillboard.com/kill/' + k.killmail_id + '/'
            });
        }
        log('INFO', 'Processed and returning ' + out.length + ' kills.');
        return out;
    } catch (err) {
        log('ERROR', 'zKill fetch failed: ' + err.message);
        return [];
    }
}

window.zkillApi = { fetchRecentKills: fetchRecentKills };
})();