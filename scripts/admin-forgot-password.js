(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AdminForgotPassword = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function safeCall(fn, ...args) {
    if (typeof fn !== 'function') return undefined;
    return fn(...args);
  }

  function bindForgotPasswordTrigger(options) {
    const trigger = options && options.trigger;
    const onOpen = options && options.onOpen;
    if (!trigger || typeof trigger.addEventListener !== 'function') return false;
    if (trigger.dataset && trigger.dataset.boundForgotTrigger === '1') return true;

    const onTriggerClick = (event) => {
      if (event) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
      }
      safeCall(onOpen);
    };

    trigger.addEventListener('click', onTriggerClick, true);
    trigger.addEventListener('keydown', (event) => {
      if (!event) return;
      if (event.key === 'Enter' || event.key === ' ') {
        onTriggerClick(event);
      }
    });

    if (trigger.dataset) trigger.dataset.boundForgotTrigger = '1';
    return true;
  }

  function createSubmitHandler(options) {
    const form = options && options.form;
    const button = options && options.button;
    const emailInput = options && options.emailInput;
    const getEndpoints = (options && options.getEndpoints) || (() => []);
    const loginRequest = options && options.loginRequest;
    const pushAuthTelemetry = options && options.pushAuthTelemetry;
    const showToast = (options && options.showToast) || (() => {});
    const closeModal = options && options.closeModal;
    const refreshIcons = options && options.refreshIcons;

    return async function handleForgotPasswordSubmit(event) {
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }

      const email = String(emailInput && emailInput.value ? emailInput.value : '').trim();
      if (!email) {
        showToast('Email wajib diisi.', 'error');
        return;
      }

      const oriText = button && typeof button.innerHTML === 'string' ? button.innerHTML : '';
      if (button) {
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Mengirim...';
        button.disabled = true;
      }
      safeCall(refreshIcons);

      try {
        const payload = { action: 'forgot_password', email };
        const endpoints = Array.isArray(getEndpoints()) ? getEndpoints() : [];
        if (!endpoints.length) throw new Error('Config.js tidak terpanggil!');

        let responseData = null;
        let lastErr = null;

        for (const endpoint of endpoints) {
          try {
            const out = await loginRequest(endpoint, payload);
            responseData = out && out.data ? out.data : null;
            safeCall(pushAuthTelemetry, {
              stage: 'forgot_password_attempt',
              outcome: 'success-response',
              ...(out && out.telemetry ? out.telemetry : {})
            });
            break;
          } catch (err) {
            lastErr = err;
            safeCall(pushAuthTelemetry, {
              stage: 'forgot_password_attempt',
              outcome: 'error-response',
              endpoint,
              message: String(err && err.message ? err.message : err),
              ...(err && err.telemetry ? err.telemetry : {})
            });
          }
        }

        if (!responseData) throw (lastErr || new Error('Gagal terhubung ke server.'));

        if (responseData.status === 'success') {
          showToast(String(responseData.message || 'Password telah dikirim ke email anda.'), 'success');
          if (form && typeof form.reset === 'function') form.reset();
          safeCall(closeModal);
        } else {
          showToast(String(responseData.message || 'Email tidak ditemukan.'), 'error');
        }
      } catch (err) {
        showToast(String((err && err.message) ? err.message : 'Error Koneksi!'), 'error');
      } finally {
        if (button) {
          button.innerHTML = oriText;
          button.disabled = false;
        }
        safeCall(refreshIcons);
      }
    };
  }

  return {
    bindForgotPasswordTrigger,
    createSubmitHandler
  };
});
