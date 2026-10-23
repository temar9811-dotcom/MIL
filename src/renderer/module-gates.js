// # FILE: src/renderer/module-gates.js
// # VERSION: 3
// The one place that decides which optional modules exist in this window.
//
// Every module listed here is OFF by default and is only constructed when the
// user turns it on in Other Settings. A module that is off has:
//   * its tab button hidden,
//   * its panel never revealed,
//   * its scripts never injected, so none of its code is parsed or executed,
//   * its pollers never started, because the code that owns them is not loaded.
//
// The only thing that is always present is the alert path: the settings window
// keeps the log reader and the alert system running, and gated modules are
// allowed to feed it. No gated module may reach another gated module; they
// share nothing but that alert path.
(function () {
  'use strict';

  // `tab` is the data-tab value used by ui-tabs, `panel` the content element,
  // `scripts` what must be injected before the module can work, `setting` the
  // config key that gates it.
  var MODULES = [
    {
      id: 'map',
      label: 'Intel Map',
      tab: 'intel-map',
      panel: 'intel-map-panel',
      setting: 'mapEnabled',
      scripts: ['ui-map-render.js', 'ui-pyramid-render.js', 'ui-pyramid.js'],
    },
    {
      id: 'zkill',
      label: 'Zkill',
      tab: 'zkill',
      panel: 'zkill-panel',
      setting: 'zkillEnabled',
      scripts: ['ui-zkill-render.js', 'zkill-data.js', 'zkill-api.js', 'ui-zkill.js'],
    },
    {
      id: 'local',
      label: 'Local Monitor',
      tab: 'local-monitor',
      panel: 'local-monitor-panel',
      setting: 'localMonitorEnabled',
      scripts: ['ui-local-monitor.js'],
    },
  ];

  var injected = {};
  var injecting = {};
  var enabled = {};
  var visible = {};
  var settings = null;
  var mapPopoutOpen = false;

  function log(level, msg) {
    if (typeof window.appendDebug === 'function') window.appendDebug(level, 'Gates: ' + msg);
  }

  function mod(id) {
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i];
    return null;
  }

  function tabButton(m) {
    return document.querySelector('.tab-btn[data-tab="' + m.tab + '"]');
  }

  // Inject a module's scripts once, in order, waiting for each so a module's
  // dependencies exist before its own code runs.
  //
  // The in-flight promise matters. Enabling a module and then clicking its tab
  // are two separate calls into here, and the click usually lands while the
  // three scripts are still loading. Without the guard the second call starts a
  // second chain, so the module's own file is evaluated twice: two copies of
  // its state, two poll timers, and the first copy's timer orphaned with
  // nothing left that can ever stop it. Callers joining the in-flight chain
  // instead all get one load and one activation.
  function inject(m, done) {
    if (injected[m.id]) {
      if (done) done(true);
      return;
    }
    if (injecting[m.id]) {
      injecting[m.id].then(function (ok) { if (done) done(ok); });
      return;
    }
    var list = m.scripts.slice();
    var chain = new Promise(function (resolve) {
      var next = function (ok) {
        if (!ok) {
          log('ERROR', 'failed to load ' + m.label + ' scripts');
          resolve(false);
          return;
        }
        var file = list.shift();
        if (!file) {
          injected[m.id] = true;
          log('INFO', m.label + ' module loaded');
          resolve(true);
          return;
        }
        var s = document.createElement('script');
        s.src = file;
        s.onload = function () { next(true); };
        s.onerror = function () { log('ERROR', 'could not load ' + file); next(false); };
        document.body.appendChild(s);
      };
      next(true);
    });
    injecting[m.id] = chain;
    chain.then(function (ok) {
      // Cleared either way: a failed load must be retryable on the next sync,
      // not cached as a permanent failure.
      delete injecting[m.id];
      if (done) done(ok);
    });
  }

  // Poll only when all of these hold: the module is enabled, this window is
  // showing it, and (for the map) no pop-out window is doing the work instead.
  function shouldRun(m) {
    if (!enabled[m.id]) return false;
    if (!visible[m.id]) return false;
    if (m.id === 'map' && mapPopoutOpen) return false;
    return true;
  }

  // The single "should this module be working right now" edge. ui-tabs calls
  // this when a panel is shown or hidden, the settings save calls it when a gate
  // flips, and the pop-out handshake calls it when the pop-out opens or closes.
  function setModuleActive(m, on) {
    if (m.id === 'map' && window.IntelMap && typeof window.IntelMap.setActive === 'function') {
      window.IntelMap.setActive(on);
    } else if (m.id === 'zkill' && window.Zkill && typeof window.Zkill.setActive === 'function') {
      // Fill the inputs before starting the poller, otherwise the first poll
      // runs against whatever the markup defaults happen to be.
      if (on && settings && typeof window.loadZkillSettings === 'function') {
        window.loadZkillSettings(settings);
      }
      window.Zkill.setActive(on);
    } else if (m.id === 'local' && typeof window.loadLocalMonitorSettings === 'function') {
      // The local monitor's renderer is a pure view; the main process owns the
      // running state, so pushing settings into it is all that is needed.
      if (on && settings) window.loadLocalMonitorSettings(settings);
    }
  }

  function sync(id) {
    var m = mod(id);
    if (!m) return;
    if (!enabled[m.id]) {
      // Off: tear the module down rather than leaving it polling in the dark.
      setModuleActive(m, false);
      return;
    }
    inject(m, function (ok) {
      if (!ok) return;
      var run = shouldRun(m);
      setModuleActive(m, run);
      if (run) log('INFO', m.label + ' active');
    });
  }

  // Called by ui-tabs when a panel is shown or hidden.
  function setVisible(id, on) {
    visible[id] = !!on;
    sync(id);
  }

  function applySettings(next) {
    settings = next || null;
    for (var i = 0; i < MODULES.length; i++) {
      var m = MODULES[i];
      var on = !!(settings && settings[m.setting]);
      if (enabled[m.id] === on) continue;
      enabled[m.id] = on;
      var btn = tabButton(m);
      if (btn) btn.classList.toggle('hidden', !on);
      log('INFO', m.label + (on ? ' enabled' : ' disabled'));
    }
    // Re-run every gate: a flip can mean a tab is now reachable, or a module
    // that was mid-poll has to stop.
    for (var j = 0; j < MODULES.length; j++) sync(MODULES[j].id);
  }

  function isEnabled(id) {
    return !!enabled[id];
  }

  // The map pop-out reports itself. While it is open the tab must not refresh:
  // two pollers on the same data is duplicated CPU and RAM for nothing.
  function setMapPopoutOpen(on) {
    mapPopoutOpen = !!on;
    log('INFO', 'Intel Map pop-out ' + (mapPopoutOpen
      ? 'opened - tab refresh paused'
      : 'closed - tab refresh resumed'));
    sync('map');
  }

  if (window.electronAPI && window.electronAPI.onIntelMapPopout) {
    window.electronAPI.onIntelMapPopout(setMapPopoutOpen);
  }

  window.ModuleGates = {
    register: MODULES,
    applySettings: applySettings,
    setVisible: setVisible,
    isEnabled: isEnabled,
    isMapPopoutOpen: function () { return mapPopoutOpen; },
    setMapPopoutOpen: setMapPopoutOpen,
    sync: sync,
  };
})();
