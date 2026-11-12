// Minimal boot module extracted from inline IIFE in index.html
// Purpose: attach `window.showFatalError`, global error handlers, and boot watchdog.

// Immediately run module scope
(function() {
  let errorDisplayed = false;

  function getUI() {
    return {
      loader: document.getElementById('initial-loader'),
      spinner: document.getElementById('loader-spinner'),
      errUi: document.getElementById('fatal-error-ui'),
      errTitle: document.getElementById('error-title'),
      errMsg: document.getElementById('error-message')
    };
  }

  function showFatalError(msg, isWatchdog) {
    if (errorDisplayed) return;
    errorDisplayed = true;

    const ui = getUI();

    if (!ui.loader || !ui.loader.isConnected) {
      if (!isWatchdog) alert('Erro Crítico: ' + msg);
      return;
    }

    if (ui.spinner) ui.spinner.style.display = 'none';

    if (ui.errUi) {
      if (ui.errTitle) ui.errTitle.textContent = isWatchdog ? 'Tempo Excedido' : 'Falha Crítica';
      if (ui.errMsg) ui.errMsg.textContent = msg || 'Erro interno.';
      ui.errUi.classList.remove('d-none');
    }

    ui.loader.classList.remove('hidden');
  }

  function onerrorHandler(message, source, lineno, colno, error) {
    const msg = message || (error && error.message) || '';
    if (typeof msg === 'string' && (msg.indexOf('OneSignal') !== -1 || msg.indexOf('onesignal') !== -1)) {
      console.warn('Caught and suppressed OneSignal library error:', msg);
      return true;
    }
    if (typeof msg === 'string' && msg.includes('ResizeObserver loop')) {
      return true;
    }

    showFatalError(msg);
    return false;
  }

  function onUnhandledRejection(event) {
    const reason = event && event.reason;
    const msg = 'Erro Assíncrono: ' + (reason ? (reason.message || reason) : 'Desconhecido');
    if (typeof msg === 'string' && (msg.indexOf('OneSignal') !== -1 || msg.indexOf('onesignal') !== -1)) {
      console.warn('Caught and suppressed OneSignal unhandled rejection:', msg);
      return;
    }
    showFatalError(msg);
  }

  // Attach to window
  try {
    window.showFatalError = showFatalError;
    window.onerror = onerrorHandler;
    window.onunhandledrejection = onUnhandledRejection;
  } catch (e) {
    // In constrained environments, fail silently
    console.warn('error-handler: could not attach global handlers', e && e.message);
  }

  // Attach retry button handler if present
  function attachRetryHandler() {
    const btn = document.getElementById('fatal-retry-btn');
    if (!btn) return;
    try {
      btn.addEventListener('click', function() {
        try {
          window.location.reload();
        } catch (_) {
          // fallback
          window.location.href = window.location.href;
        }
      }, { passive: true });
    } catch (e) {
      // ignore
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachRetryHandler);
  } else {
    attachRetryHandler();
  }

  // Watchdog: check loader after 8s
  try {
    window.bootWatchdog = setTimeout(function() {
      const ui = getUI();
      if (ui.loader && ui.loader.isConnected && !ui.loader.classList.contains('hidden')) {
        window.showFatalError('O aplicativo demorou muito para responder. Verifique sua conexão.', true);
      }
    }, 8000);
  } catch (e) {
    // ignore
  }
})();
