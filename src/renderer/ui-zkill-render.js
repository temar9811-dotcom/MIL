// # FILE: src/renderer/ui-zkill-render.js
// # VERSION: 2
/**
Zkill tab table renderer.
Generates a clean, responsive table/grid layout for the killstream.
Exposes: window.zkillRender.renderKills()
*/
(function () {
function formatTime(ts) {
    if (!ts) return '?';
    var d = new Date(ts);
    return d.toLocaleTimeString();
}

function formatPulledTime(ts) {
    if (!ts) return '?';
    var d = new Date(ts);
    // Extract HH:MM:SS from ISO string and append 'Z' to indicate UTC
    return d.toISOString().slice(11, 19) + 'Z';
}

function renderKills(killList, kills) {
    if (!killList) return;
    killList.innerHTML = '';
    
    if (!kills || kills.length === 0) {
        var p = document.createElement('p');
        p.style.color = '#888';
        p.textContent = 'No kills in stream range.';
        killList.appendChild(p);
        return;
    }
    
    var table = document.createElement('table');
    table.className = 'zkill-table';
    
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr>' +
        '<th>Kill Time</th>' +
        '<th>System</th>' +
        '<th>Victim</th>' +
        '<th>Ship</th>' +
        '<th>Final Blow</th>' +
        '<th>Attackers</th>' +
        '<th>Pulled (UTC)</th>' +
        '</tr>';
    table.appendChild(thead);
    
    var tbody = document.createElement('tbody');
    var count = Math.min(kills.length, 100); // MAX_KILLS limit
    
    for (var i = 0; i < count; i++) {
        var k = kills[i];
        var tr = document.createElement('tr');
        tr.className = 'zkill-row';
        tr.title = 'Click to open zKillboard';
        tr.addEventListener('click', (function (url) {
            return function () { window.open(url, '_blank'); };
        })(k.url));
        
        tr.innerHTML = 
            '<td class="zkill-cell">' + formatTime(k.time) + '</td>' +
            '<td class="zkill-cell">' + (k.system || '?') + ' <span class="zkill-jumps">(' + (k.jumps || 0) + 'j)</span></td>' +
            '<td class="zkill-cell">' + (k.victim || '?') + '</td>' +
            '<td class="zkill-cell">' + (k.victimShip || '?') + '</td>' +
            '<td class="zkill-cell">' + (k.finalBlowChar || '?') + '</td>' +
            '<td class="zkill-cell">' + (k.attackers || 0) + '</td>' +
            '<td class="zkill-cell">' + formatPulledTime(k.pulledAt) + '</td>';
            
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    killList.appendChild(table);
}

window.zkillRender = { renderKills: renderKills };
})();