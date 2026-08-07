/* Phase 17.7 application bootstrap and global error boundary. */
(function () {
  'use strict';

  function reportError(error, context = 'Application') {
    console.error(`[TV Time] ${context}:`, error);
    const bar = document.getElementById('appErrorBar');
    if (!bar) return;
    bar.textContent = `${context}: ${error?.message || 'Unexpected error'}`;
    bar.classList.remove('d-none');
  }

  window.addEventListener('error', event => reportError(event.error || new Error(event.message), 'Runtime error'));
  window.addEventListener('unhandledrejection', event => reportError(event.reason, 'Async error'));

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      { const modal = document.getElementById('showManagerModal'); modal?.classList.add('d-none'); modal?.setAttribute('hidden', ''); }
      { const modal = document.getElementById('deleteShowModal'); modal?.classList.add('d-none'); modal?.setAttribute('hidden', ''); }
      await init();
      console.info('[TV Time] Phase 17.7 initialized');
    } catch (error) {
      reportError(error, 'Startup failed');
    }
  });
})();
