// MIL ui-alert-card v1 - shared alert card for the docked tab and the pop-out
(function () {
  var ALLOWED_HOSTS = ['dscan.info', 'adashboard.info', 'zkillboard.com'];

  function span(text) {
    var s = document.createElement('span');
    s.textContent = text;
    return s;
  }

  function hostOf(href) {
    try {
      return new URL(href, 'https://placeholder.invalid').hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function isAllowed(href) {
    var host = hostOf(href);
    if (!host) return false;
    return ALLOWED_HOSTS.some(function (h) {
      return host === h || host.endsWith('.' + h);
    });
  }

  function shortLabel(host) {
    if (host === 'dscan.info' || host.endsWith('.dscan.info')) return 'd-scan';
    if (host === 'adashboard.info' || host.endsWith('.adashboard.info')) return 'adashboard';
    if (host === 'zkillboard.com' || host.endsWith('.zkillboard.com')) return 'zkill';
    return host;
  }

  function anchor(href, text) {
    var a = document.createElement('a');
    a.textContent = text;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = href;
    a.style.color = '#6ec1ff';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      window.open(href, '_blank');
    });
    return a;
  }

  function linkNode(href) {
    if (isAllowed(href)) return anchor(href, shortLabel(hostOf(href)));
    return span(href);
  }

  function pilotNode(data) {
    var text = data.pilot || data.label || '?';
    if (data.pilot && data.pilotUrl && isAllowed(data.pilotUrl)) return anchor(data.pilotUrl, text);
    return span(text);
  }

  function collectHrefs(data) {
    var out = [];
    var links = (data.links && data.links.length) ? data.links : (data.url ? [data.url] : []);
    for (var i = 0; i < links.length; i++) out.push(links[i]);
    if (data.pilotUrl) out.push(data.pilotUrl);
    return out;
  }

  function make(data) {
    data = data || {};
    var el = document.createElement('div');
    el.className = 'alert alert-' + (data.type === 'red' ? 'red' : 'soft');
    el.style.whiteSpace = 'nowrap';
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
    if (data.color) el.style.borderLeft = '4px solid ' + data.color;
    if (data.id != null) el.setAttribute('data-alert-id', String(data.id));

    if (data.time) {
      var t = span(new Date(data.time).toLocaleTimeString([], { hour12: false }));
      t.style.opacity = '0.7';
      t.style.fontSize = '11px';
      t.style.marginRight = '8px';
      el.appendChild(t);
    }

    var segments = [];
    var hasLocation = data.character != null || data.jumps != null || data.system != null;
    if (data.linkOnly) {
      segments.push(span(data.label || 'D-scan link'));
    } else {
      if (hasLocation) {
        segments.push(span(data.character || '?'));
        segments.push(span(data.jumps == null ? '?' : data.jumps + ' jumps'));
        segments.push(span(data.system || '?'));
      }
      segments.push(pilotNode(data));
      if (data.ship) segments.push(span(data.ship));
    }

    for (var i = 0; i < segments.length; i++) {
      if (i) el.appendChild(document.createTextNode(' > '));
      el.appendChild(segments[i]);
    }

    var links = (data.links && data.links.length) ? data.links : (data.url ? [data.url] : []);
    for (var j = 0; j < links.length; j++) {
      el.appendChild(document.createTextNode(' '));
      el.appendChild(linkNode(links[j]));
    }

    var tip = el.textContent;
    var hrefs = collectHrefs(data);
    if (hrefs.length) tip += ' \u2014 ' + hrefs.join(' ');
    el.title = tip;
    return el;
  }

  function patch(el, data) {
    if (!el || !data) return;
    var fresh = make(data);
    el.className = fresh.className;
    el.style.borderLeft = fresh.style.borderLeft;
    el.title = fresh.title;
    if (data.id != null) el.setAttribute('data-alert-id', String(data.id));
    while (el.firstChild) el.removeChild(el.firstChild);
    while (fresh.firstChild) el.appendChild(fresh.firstChild);
  }

  window.alertCard = { make: make, patch: patch };
})();
