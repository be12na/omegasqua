/** @jest-environment jsdom */

const {
  bindForgotPasswordTrigger,
  createSubmitHandler
} = require('../scripts/admin-forgot-password.js');

describe('Admin forgot-password interactions', () => {
  test('bindForgotPasswordTrigger catches click and keyboard interaction', () => {
    document.body.innerHTML = '<button id="btn-forgot-open-admin" type="button">Lupa Password?</button>';
    const trigger = document.getElementById('btn-forgot-open-admin');
    const onOpen = jest.fn();

    const bound = bindForgotPasswordTrigger({ trigger, onOpen });
    expect(bound).toBe(true);
    expect(trigger.dataset.boundForgotTrigger).toBe('1');

    const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(clickEvt);
    expect(clickEvt.defaultPrevented).toBe(true);

    const keyEvt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    trigger.dispatchEvent(keyEvt);
    expect(keyEvt.defaultPrevented).toBe(true);

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  test('submit handler triggers forgot_password API payload and closes modal on success', async () => {
    document.body.innerHTML = `
      <form id="form-forgot-admin">
        <input id="adm-email-forgot" type="email" value="owner@example.com" />
        <button id="btn-forgot-admin" type="submit">Kirim Password</button>
      </form>
    `;

    const form = document.getElementById('form-forgot-admin');
    const emailInput = document.getElementById('adm-email-forgot');
    const button = document.getElementById('btn-forgot-admin');

    const loginRequest = jest.fn().mockResolvedValue({
      data: { status: 'success', message: 'Password telah dikirim ke email anda.' },
      telemetry: { endpoint: '/api', requestId: 'req-1' }
    });
    const getEndpoints = jest.fn(() => ['/api']);
    const pushAuthTelemetry = jest.fn();
    const showToast = jest.fn();
    const closeModal = jest.fn();
    const refreshIcons = jest.fn();

    const handler = createSubmitHandler({
      form,
      button,
      emailInput,
      getEndpoints,
      loginRequest,
      pushAuthTelemetry,
      showToast,
      closeModal,
      refreshIcons
    });

    const evt = { preventDefault: jest.fn() };
    await handler(evt);

    expect(evt.preventDefault).toHaveBeenCalled();
    expect(loginRequest).toHaveBeenCalledTimes(1);
    expect(loginRequest).toHaveBeenCalledWith('/api', {
      action: 'forgot_password',
      email: 'owner@example.com'
    });
    expect(pushAuthTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'forgot_password_attempt',
      outcome: 'success-response'
    }));
    expect(showToast).toHaveBeenCalledWith('Password telah dikirim ke email anda.', 'success');
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
  });

  test('submit handler falls back to next endpoint when first endpoint fails', async () => {
    document.body.innerHTML = `
      <form id="form-forgot-admin">
        <input id="adm-email-forgot" type="email" value="owner@example.com" />
        <button id="btn-forgot-admin" type="submit">Kirim Password</button>
      </form>
    `;

    const form = document.getElementById('form-forgot-admin');
    const emailInput = document.getElementById('adm-email-forgot');
    const button = document.getElementById('btn-forgot-admin');

    const loginRequest = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('endpoint-a-fail'), { telemetry: { endpoint: '/api' } }))
      .mockResolvedValueOnce({
        data: { status: 'success', message: 'ok' },
        telemetry: { endpoint: '/gas' }
      });

    const handler = createSubmitHandler({
      form,
      button,
      emailInput,
      getEndpoints: () => ['/api', '/gas'],
      loginRequest,
      pushAuthTelemetry: jest.fn(),
      showToast: jest.fn(),
      closeModal: jest.fn(),
      refreshIcons: jest.fn()
    });

    await handler({ preventDefault: jest.fn() });
    expect(loginRequest).toHaveBeenCalledTimes(2);
    expect(loginRequest).toHaveBeenNthCalledWith(1, '/api', expect.objectContaining({ action: 'forgot_password' }));
    expect(loginRequest).toHaveBeenNthCalledWith(2, '/gas', expect.objectContaining({ action: 'forgot_password' }));
  });
});
