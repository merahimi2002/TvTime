(function () {
  'use strict';

  const DEFAULT_DURATION = 6500;
  let host;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.id = 'tvtimeToastHost';
    host.className = 'tvtime-toast-host';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'false');
    document.body.appendChild(host);
    return host;
  }

  function iconFor(type) {
    return ({
      success: 'bi-check-circle-fill',
      warning: 'bi-exclamation-triangle-fill',
      info: 'bi-info-circle-fill',
      error: 'bi-x-octagon-fill'
    })[type] || 'bi-x-octagon-fill';
  }

  function show(message, options = {}) {
    const type = options.type || 'error';
    const duration = Math.max(1200, Number(options.duration || DEFAULT_DURATION));
    const title = options.title || ({ success: 'Done', warning: 'Warning', info: 'Notice', error: 'Something went wrong' }[type]);
    const toast = document.createElement('article');
    toast.className = `tvtime-toast tvtime-toast-${type}`;
    toast.innerHTML = `
      <div class="tvtime-toast-icon"><i class="bi ${iconFor(type)}"></i></div>
      <div class="tvtime-toast-content">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(normalizeMessage(message))}</p>
      </div>
      <button class="tvtime-toast-close" type="button" aria-label="Dismiss"><i class="bi bi-x-lg"></i></button>
      <div class="tvtime-toast-timer" style="--toast-duration:${duration}ms"></div>`;

    ensureHost().appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));

    let timer = setTimeout(remove, duration);
    function remove() {
      clearTimeout(timer);
      toast.classList.remove('is-visible');
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 240);
    }
    toast.querySelector('.tvtime-toast-close').addEventListener('click', remove);
    toast.addEventListener('mouseenter', () => {
      clearTimeout(timer);
      toast.classList.add('is-paused');
    });
    toast.addEventListener('mouseleave', () => {
      toast.classList.remove('is-paused');
      timer = setTimeout(remove, 2200);
    });
    return { close: remove, element: toast };
  }

  function normalizeMessage(value) {
    if (value instanceof Error) return value.message || value.name;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return 'Unknown error.'; }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  window.TVTimeErrors = {
    show,
    error: (message, title) => show(message, { type: 'error', title }),
    warning: (message, title) => show(message, { type: 'warning', title }),
    info: (message, title) => show(message, { type: 'info', title }),
    success: (message, title) => show(message, { type: 'success', title })
  };

  window.addEventListener('error', event => {
    const message = event.error?.message || event.message;
    if (!message || /ResizeObserver loop/i.test(message)) return;
    show(message, { title: 'Application error', type: 'error' });
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = reason?.message || normalizeMessage(reason);
    if (!message) return;
    show(message, { title: 'Async error', type: 'error', duration: 8500 });
  });
})();
