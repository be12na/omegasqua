const { chromium, firefox, webkit, devices } = require('playwright');

const TARGET_URL = process.env.ADMIN_AREA_URL || 'http://127.0.0.1:4173/admin-area.html';

function buildCases() {
  return [
    {
      name: 'chromium',
      launch: () => chromium.launch({ headless: true }),
      context: {}
    },
    {
      name: 'firefox',
      launch: () => firefox.launch({ headless: true }),
      context: {}
    },
    {
      name: 'webkit',
      launch: () => webkit.launch({ headless: true }),
      context: {}
    },
    {
      name: 'edge',
      launch: () => chromium.launch({ headless: true, channel: 'msedge' }),
      context: {}
    },
    {
      name: 'mobile-chrome',
      launch: () => chromium.launch({ headless: true }),
      context: {
        ...devices['Pixel 5']
      }
    }
  ];
}

async function runOneCase(testCase) {
  let browser;
  try {
    browser = await testCase.launch();
  } catch (error) {
    return {
      name: testCase.name,
      status: 'skipped',
      reason: `browser launch failed: ${String(error && error.message ? error.message : error)}`
    };
  }

  const context = await browser.newContext(testCase.context || {});
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-forgot-open-admin', { state: 'visible', timeout: 20000 });

    await page.evaluate(() => {
      window.__forgotFetchPayloads = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
        const body = typeof init.body === 'string' ? init.body : '';
        if (body && body.includes('"action":"forgot_password"')) {
          window.__forgotFetchPayloads.push({ url, body });
        }

        // Keep non-forgot requests untouched.
        if (!body || !body.includes('"action":"forgot_password"')) {
          return originalFetch(input, init);
        }

        return new Response(JSON.stringify({
          status: 'success',
          message: 'Password telah dikirim ke email anda.'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };
    });

    await page.click('#btn-forgot-open-admin');
    const modalClass = await page.getAttribute('#modal-forgot-admin', 'class');
    if (!modalClass || modalClass.includes('hidden')) {
      throw new Error('forgot-password modal is not visible after click');
    }

    await page.fill('#adm-email-forgot', 'qa@example.com');
    await page.click('#btn-forgot-admin');

    await page.waitForTimeout(200);
    const payloads = await page.evaluate(() => window.__forgotFetchPayloads || []);
    if (!payloads.length) {
      throw new Error('forgot-password API call was not triggered');
    }

    const lastPayload = payloads[payloads.length - 1];
    let parsedBody = null;
    try {
      parsedBody = JSON.parse(lastPayload.body || '{}');
    } catch (err) {
      throw new Error('forgot-password request body is not valid JSON');
    }

    if (!parsedBody || parsedBody.action !== 'forgot_password') {
      throw new Error('forgot-password payload action mismatch');
    }
    if (parsedBody.email !== 'qa@example.com') {
      throw new Error('forgot-password payload email mismatch');
    }

    if (consoleErrors.length) {
      return {
        name: testCase.name,
        status: 'failed',
        reason: 'console errors detected',
        consoleErrors
      };
    }

    return {
      name: testCase.name,
      status: 'passed',
      consoleErrors
    };
  } catch (error) {
    return {
      name: testCase.name,
      status: 'failed',
      reason: String(error && error.message ? error.message : error),
      consoleErrors
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const cases = buildCases();
  const results = [];

  for (const testCase of cases) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runOneCase(testCase);
    results.push(result);
    if (result.status === 'passed') {
      console.log(`[PASS] ${result.name}`);
    } else if (result.status === 'skipped') {
      console.log(`[SKIP] ${result.name}: ${result.reason}`);
    } else {
      console.log(`[FAIL] ${result.name}: ${result.reason}`);
    }

    if (result.consoleErrors && result.consoleErrors.length) {
      console.log(`[${result.name}] console errors:`);
      for (const err of result.consoleErrors) {
        console.log(`  - ${err}`);
      }
    }
  }

  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[FATAL] Cross-browser forgot-password test runner failed:', error);
  process.exit(1);
});
