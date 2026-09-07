// File-style tab switching. Buttons and panels match via data-tab.
(function () {
  function pairs() {
    const buttons = Array.from(document.querySelectorAll('.tab-btn'));
    const panels = Array.from(document.querySelectorAll('.tab-content'));
    const byKey = new Map(panels.map((p) => [p.dataset.tab, p]));
    return buttons.map((btn, i) => ({
      btn,
      panel: byKey.get(btn.dataset.tab) || panels[i] || null,
    }));
  }

  function show(key) {
    for (const { btn, panel } of pairs()) {
      const on = (btn.dataset.tab || '') === key;
      btn.classList.toggle('active', on);
      if (panel) panel.classList.toggle('active', on);
    }
  }

  function init() {
    const list = pairs();
    list.forEach(({ btn }) => {
      btn.addEventListener('click', () => show(btn.dataset.tab));
    });
    const start = list.find(({ btn }) => btn.classList.contains('active')) || list[0];
    if (start) show(start.btn.dataset.tab);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.uiTabs = { show };
})();