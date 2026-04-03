const fs = require('fs');
const path = require('path');

function loadWorker() {
  const filePath = path.resolve(__dirname, '..', '_worker.js');
  const source = fs
    .readFileSync(filePath, 'utf8')
    .replace(/export\s+default\s*\{/m, 'module.exports = {');

  const moduleShim = { exports: {} };
  const factory = new Function('module', 'exports', 'require', source);
  factory(moduleShim, moduleShim.exports, require);
  return moduleShim.exports;
}

function createMemoryCache() {
  const store = new Map();
  return {
    async match(request) {
      const key = (request && request.url) ? request.url : String(request || '');
      const hit = store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      const key = (request && request.url) ? request.url : String(request || '');
      store.set(key, response.clone());
    },
    async delete(request) {
      const key = (request && request.url) ? request.url : String(request || '');
      return store.delete(key);
    }
  };
}

function extractCatalogVersion(payload) {
  const list = Array.isArray(payload && payload.data)
    ? payload.data
    : Array.isArray(payload && payload.products)
      ? payload.products
      : (payload && payload.data && Array.isArray(payload.data.products) ? payload.data.products : []);
  return list[0] && typeof list[0] === 'object' ? Number(list[0].v) : null;
}

describe('Worker cache invalidation', () => {
  test('mutation bumps cache version and bypasses stale read cache key', async () => {
    if (!global.crypto || !global.crypto.subtle) {
      global.crypto = require('crypto').webcrypto;
    }

    global.caches = { default: createMemoryCache() };

    let catalogVersion = 1;
    const upstreamStats = { get_products: 0, save_product: 0 };

    global.fetch = jest.fn(async (_url, init = {}) => {
      const payload = JSON.parse(String(init.body || '{}'));
      const action = String(payload.action || '').trim().toLowerCase();

      if (action === 'get_products') {
        upstreamStats.get_products += 1;
        return new Response(JSON.stringify({
          status: 'success',
          data: [{ id: 101, name: 'PRO BARTHOJOIN', v: catalogVersion }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (action === 'save_product') {
        upstreamStats.save_product += 1;
        catalogVersion += 1;
        return new Response(JSON.stringify({
          status: 'success',
          message: 'saved'
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ status: 'success', data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const worker = loadWorker();
    const ctx = { waitUntil: (promise) => promise };
    const env = {
      API_URL: 'https://upstream.example/api',
      APP_GAS_URL: 'https://upstream.example/api',
      API_TOKEN: 'token-for-test'
    };

    const reqRead = () => new Request('https://omegasqua.test/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'get_products', email: '', cache_version: '1' })
    });

    const firstRead = await worker.fetch(reqRead(), env, ctx);
    const firstPayload = await firstRead.json();
    expect(extractCatalogVersion(firstPayload)).toBe(1);
    expect(upstreamStats.get_products).toBe(1);

    const secondRead = await worker.fetch(reqRead(), env, ctx);
    const secondPayload = await secondRead.json();
    expect(extractCatalogVersion(secondPayload)).toBe(1);
    expect(upstreamStats.get_products).toBe(1);

    const mutateReq = new Request('https://omegasqua.test/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'save_product', payload: { id: 101, name: 'PRO BARTHOJOIN' } })
    });
    const mutateRes = await worker.fetch(mutateReq, env, ctx);
    const mutatePayload = await mutateRes.json();
    expect(mutatePayload.status).toBe('success');
    expect(upstreamStats.save_product).toBe(1);

    const thirdRead = await worker.fetch(reqRead(), env, ctx);
    const thirdPayload = await thirdRead.json();
    expect(extractCatalogVersion(thirdPayload)).toBe(2);
    expect(upstreamStats.get_products).toBe(2);
  });
});
