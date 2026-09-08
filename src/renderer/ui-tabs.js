// # FILE: src/renderer/ui-tabs.js
// # VERSION: 2

// MIL ui-tabs v2 - tab switching for settings, alerts, and debug log
(function() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      // Remove active class from all buttons and contents
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      // Add active class to clicked button and corresponding content
      btn.classList.add('active');
      
      if (targetTab === 'settings') {
        document.getElementById('settings-panel').classList.add('active');
      } else if (targetTab === 'alerts') {
        document.getElementById('alerts-panel').classList.add('active');
      } else if (targetTab === 'debug') {
        document.getElementById('debug-panel-wrapper').classList.add('active');
      }
    });
  });
})();