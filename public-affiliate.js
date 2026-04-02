(() => {
  const PAGE = document.body.dataset.page || '';
  const DEFAULT_SETTINGS = {
    site_name: 'Omegasqua',
    site_tagline: 'Solusi affiliate herbal terpercaya untuk kebutuhan kesehatan keluarga Indonesia.',
    site_logo: '',
    site_favicon: '',
    contact_email: 'support@omegasqua.my.id',
    wa_admin: '6281234567890'
  };

  const FALLBACK_TESTIMONIALS = [
    {
      quote: 'Saya awalnya ragu ikut program partner herbal, tapi materi Omegasqua sangat jelas. Dalam 2 minggu sudah ada repeat order dari pelanggan pertama.',
      author: 'Rina, Surabaya'
    },
    {
      quote: 'Format halaman produknya sangat membantu closing. Saya tinggal pakai link affiliate dan follow-up ke WhatsApp, konversinya naik.',
      author: 'Aldi, Makassar'
    },
    {
      quote: 'Penjelasan manfaat dan disclaimer legalnya rapi, jadi saya lebih percaya diri edukasi pelanggan tanpa overclaim.',
      author: 'Siska, Bandung'
    }
  ];

  const FALLBACK_FAQS = [
    {
      q: 'Apakah produk Omegasqua sudah punya izin edar?',
      a: 'Informasi izin edar dan legalitas produk mengikuti data terbaru dari tim resmi. Silakan cek detail legal di halaman produk sebelum promosi.'
    },
    {
      q: 'Bagaimana komisi affiliate dihitung?',
      a: 'Komisi dihitung per transaksi lunas yang masuk melalui link referral Anda sesuai skema komisi pada masing-masing produk.'
    },
    {
      q: 'Apakah klaim manfaat boleh langsung dipakai untuk iklan?',
      a: 'Gunakan copy edukatif dan hindari klaim berlebihan. Selalu sertakan disclaimer bahwa hasil bisa berbeda pada setiap individu.'
    }
  ];

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    products: [],
    pages: [],
    pageMap: {},
    ref: ''
  };

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toCurrency(value) {
    return 'Rp ' + Number(value || 0).toLocaleString('id-ID');
  }

  function slugify(value) {
    return normalizeText(value).toLowerCase();
  }

  function getEndpoint() {
    return window.API_URL || window.SCRIPT_URL || null;
  }

  async function postAction(payload) {
    const endpoint = getEndpoint();
    if (!endpoint) return null;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch (error) {
      return null;
    }
  }

  async function batchActions(requests) {
    const list = Array.isArray(requests) ? requests.filter(Boolean) : [];
    if (!list.length) return [];

    if (window.CEPAT_API && typeof window.CEPAT_API.batch === 'function') {
      const result = await window.CEPAT_API.batch(list);
      if (!result || !Array.isArray(result.results)) return [];
      return result.results.map((entry) => entry && entry.data ? entry.data : null);
    }

    const responses = await Promise.all(list.map((req) => postAction(req)));
    return responses;
  }

  function persistLocalStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getRefCode() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('ref') || params.get('aff_id');
    if (fromUrl) {
      persistLocalStorage('cepat_affiliate', fromUrl);
      return fromUrl;
    }
    try {
      return localStorage.getItem('cepat_affiliate') || '';
    } catch (error) {
      return '';
    }
  }

  function withRef(url) {
    const ref = state.ref;
    if (!ref) return url;
    const glue = url.includes('?') ? '&' : '?';
    return `${url}${glue}ref=${encodeURIComponent(ref)}`;
  }

  function extractProducts(data) {
    if (!data || data.status !== 'success') return [];
    const available = Array.isArray(data.available) ? data.available : [];
    const owned = Array.isArray(data.owned) ? data.owned : [];
    const list = available.length ? available : owned;
    return list.filter(Boolean);
  }

  function mapPages(data) {
    if (!data || data.status !== 'success' || !Array.isArray(data.data)) return [];
    return data.data;
  }

  function buildPageMap(pages) {
    const map = {};
    pages.forEach((row) => {
      if (!Array.isArray(row)) return;
      const slug = slugify(row[1]);
      if (!slug) return;
      map[slug] = {
        slug,
        title: row[2] || '',
        content: row[3] || ''
      };
    });
    return map;
  }

  function getCmsBlock(slugs) {
    const candidates = Array.isArray(slugs) ? slugs : [slugs];
    for (let i = 0; i < candidates.length; i += 1) {
      const key = slugify(candidates[i]);
      if (!key) continue;
      if (state.pageMap[key] && state.pageMap[key].content) return state.pageMap[key].content;
    }
    return '';
  }

  function injectCmsBlocks() {
    const blocks = document.querySelectorAll('[data-cms-slug]');
    blocks.forEach((node) => {
      const raw = node.getAttribute('data-cms-slug') || '';
      const options = raw.split(',').map((value) => normalizeText(value)).filter(Boolean);
      if (!options.length) return;
      const content = getCmsBlock(options);
      if (!content) return;
      node.innerHTML = content;
      node.classList.remove('hidden');
    });
  }

  function applyBranding() {
    const settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };

    document.querySelectorAll('.dyn-site-name').forEach((el) => {
      el.textContent = settings.site_name || DEFAULT_SETTINGS.site_name;
    });

    document.querySelectorAll('.dyn-site-tagline').forEach((el) => {
      el.textContent = settings.site_tagline || DEFAULT_SETTINGS.site_tagline;
    });

    const logo = document.getElementById('dyn-site-logo');
    const fallback = document.getElementById('logo-fallback');
    if (logo && settings.site_logo) {
      logo.src = settings.site_logo;
      logo.alt = settings.site_name || 'Logo';
      logo.classList.remove('hidden');
      if (fallback) fallback.classList.add('hidden');
    }

    if (settings.site_favicon) {
      let icon = document.querySelector("link[rel~='icon']");
      if (!icon) {
        icon = document.createElement('link');
        icon.rel = 'icon';
        document.head.appendChild(icon);
      }
      icon.href = settings.site_favicon;
    }

    const email = normalizeText(settings.contact_email);
    const wa = String(settings.wa_admin || '').replace(/[^0-9]/g, '');

    const emailLinks = document.querySelectorAll('#dyn-email-link, [data-dyn-email-link]');
    emailLinks.forEach((emailLink) => {
      if (!email) return;
      emailLink.href = `mailto:${email}`;
      if (!emailLink.hasAttribute('data-link-only')) {
        emailLink.textContent = email;
      }
    });

    const waLinks = document.querySelectorAll('#dyn-wa-link, [data-dyn-wa-link]');
    waLinks.forEach((waLink) => {
      if (!wa) return;
      waLink.href = `https://wa.me/${wa}`;
      if (!waLink.hasAttribute('data-link-only')) {
        waLink.textContent = wa.startsWith('62') ? `+${wa}` : wa;
      }
    });
  }

  function setActiveNav() {
    const navItems = document.querySelectorAll('[data-nav]');
    navItems.forEach((link) => {
      if (link.getAttribute('data-nav') === PAGE) {
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  function renderProductCards(containerId, items, limit = 0) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const list = Array.isArray(items) ? items.slice() : [];
    const picked = limit > 0 ? list.slice(0, limit) : list;

    if (!picked.length) {
      container.innerHTML = '<div class="omega-empty">Produk belum tersedia saat ini. Hubungi tim kami untuk rekomendasi paket terbaik.</div>';
      return;
    }

    container.innerHTML = picked.map((product) => {
      const id = encodeURIComponent(product.id || '');
      const title = escapeHtml(product.title || 'Produk Herbal Omegasqua');
      const desc = escapeHtml(normalizeText(product.desc || 'Formula herbal premium untuk dukungan kebugaran harian.'));
      const price = toCurrency(product.harga);
      const detailUrl = withRef(`product.html?id=${id}`);
      const checkoutUrl = withRef(`checkout.html?id=${id}`);
      const letter = title.charAt(0) || 'O';

      return `
        <article class="omega-product-card">
          <div class="omega-product-thumb">
            ${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${title}" loading="lazy" decoding="async">` : `<span>${escapeHtml(letter)}</span>`}
          </div>
          <div class="omega-product-body">
            <div>
              <p class="omega-kicker">Herbal Premium</p>
              <h3>${title}</h3>
              <p class="omega-section-lead">${desc}</p>
            </div>
            <div class="omega-inline-list">
              <span class="omega-tag">BPOM / Izin Edar*</span>
              <span class="omega-tag">Affiliate Ready</span>
            </div>
            <div class="omega-price">${price}</div>
            <div class="omega-inline-list">
              <a class="omega-btn-secondary" href="${detailUrl}">Lihat Detail</a>
              <a class="omega-btn" href="${checkoutUrl}">Beli Sekarang</a>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderPackageTable(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const list = Array.isArray(items) ? items.slice().sort((a, b) => Number(a.harga || 0) - Number(b.harga || 0)).slice(0, 3) : [];
    if (!list.length) {
      container.innerHTML = '<div class="omega-empty">Paket promo belum tersedia saat ini. Silakan hubungi admin untuk informasi harga terbaru.</div>';
      return;
    }

    container.innerHTML = `
      <div class="omega-card">
        <table class="omega-compare-table" aria-label="Perbandingan paket produk">
          <thead>
            <tr>
              <th>Paket</th>
              <th>Harga</th>
              <th>Fokus Manfaat</th>
              <th>Komisi Partner</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((product) => `
              <tr>
                <td><strong>${escapeHtml(product.title || 'Paket Omegasqua')}</strong></td>
                <td>${toCurrency(product.harga)}</td>
                <td>${escapeHtml(normalizeText(product.desc || 'Dukungan kebugaran harian.').slice(0, 80))}</td>
                <td>${toCurrency(product.commission || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function parseJsonList(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function collectTestimonials() {
    const listFromJson = parseJsonList(getCmsBlock(['testimonials-json', 'testimoni-json']));
    if (listFromJson.length) {
      return listFromJson.map((item) => ({
        quote: normalizeText(item.quote || item.testimoni || ''),
        author: normalizeText(item.author || item.nama || 'Mitra Omegasqua')
      })).filter((item) => item.quote);
    }
    return FALLBACK_TESTIMONIALS;
  }

  function collectFaqs() {
    const listFromJson = parseJsonList(getCmsBlock(['faq-json', 'faqs-json']));
    if (listFromJson.length) {
      return listFromJson.map((item) => ({
        q: normalizeText(item.q || item.question || ''),
        a: normalizeText(item.a || item.answer || '')
      })).filter((item) => item.q && item.a);
    }
    return FALLBACK_FAQS;
  }

  function renderTestimonials(containerId, limit = 0) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const all = collectTestimonials();
    const list = limit > 0 ? all.slice(0, limit) : all;
    container.innerHTML = list.map((item) => `
      <article class="omega-card omega-testimonial">
        <p>“${escapeHtml(item.quote)}”</p>
        <p class="omega-kicker">${escapeHtml(item.author)}</p>
      </article>
    `).join('');
  }

  function renderFaqs(containerId, limit = 0) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const all = collectFaqs();
    const list = limit > 0 ? all.slice(0, limit) : all;
    container.innerHTML = list.map((item) => `
      <details class="omega-faq-item">
        <summary>${escapeHtml(item.q)}</summary>
        <p>${escapeHtml(item.a)}</p>
      </details>
    `).join('');
  }

  function findProductBySlug(slug) {
    const needle = slugify(slug);
    if (!needle) return null;
    return state.products.find((product) => {
      const lp = String(product.lp_url || '');
      if (!lp) return false;
      try {
        const url = new URL(lp, window.location.href);
        const lpSlug = slugify(url.searchParams.get('s') || '');
        return lpSlug === needle;
      } catch (error) {
        return lp.toLowerCase().includes(needle);
      }
    }) || null;
  }

  function renderProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const id = normalizeText(params.get('id'));
    const slug = normalizeText(params.get('slug') || params.get('s'));
    let product = null;

    if (id) product = state.products.find((item) => String(item.id) === id) || null;
    if (!product && slug) product = findProductBySlug(slug);
    if (!product && state.products.length) product = state.products[0];

    if (!product) return;

    const nameEl = document.getElementById('product-name');
    const descEl = document.getElementById('product-description');
    const priceEl = document.getElementById('product-price');
    const buyEl = document.getElementById('product-buy-link');
    const mobileEl = document.getElementById('sticky-mobile-link');

    if (nameEl) nameEl.textContent = product.title || 'Produk Omegasqua';
    if (descEl) descEl.textContent = normalizeText(product.desc || 'Formula herbal premium untuk mendukung kebutuhan kebugaran Anda.');
    if (priceEl) priceEl.textContent = toCurrency(product.harga);

    const checkoutUrl = withRef(`checkout.html?id=${encodeURIComponent(product.id || '')}`);
    if (buyEl) buyEl.href = checkoutUrl;
    if (mobileEl) mobileEl.href = checkoutUrl;

    renderTestimonials('product-testimonials', 2);
    renderFaqs('product-faq', 2);
  }

  function renderAffiliateTable() {
    const container = document.getElementById('affiliate-commission-table');
    if (!container) return;
    const list = state.products.slice(0, 6);
    if (!list.length) {
      container.innerHTML = '<div class="omega-empty">Skema komisi partner akan ditampilkan setelah katalog aktif.</div>';
      return;
    }
    container.innerHTML = `
      <div class="omega-card">
        <table class="omega-compare-table" aria-label="Skema komisi affiliate">
          <thead>
            <tr>
              <th>Produk</th>
              <th>Harga Jual</th>
              <th>Estimasi Komisi</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((product) => `
              <tr>
                <td>${escapeHtml(product.title || '-')}</td>
                <td>${toCurrency(product.harga)}</td>
                <td>${toCurrency(product.commission || 0)}</td>
                <td><a href="${withRef(`product.html?id=${encodeURIComponent(product.id || '')}`)}">Detail</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function syncStickyCta(defaultHref) {
    const link = document.getElementById('sticky-mobile-link');
    if (!link) return;
    const next = withRef(defaultHref || link.getAttribute('href') || 'products.html');
    link.href = next;
  }

  async function hydrateState() {
    state.ref = getRefCode();

    const cacheState = (window.CEPAT_CACHE_STATE && typeof window.CEPAT_CACHE_STATE.ensureFresh === 'function')
      ? await window.CEPAT_CACHE_STATE.ensureFresh().catch(() => null)
      : null;

    const settingsVersion = String(cacheState && cacheState.settings ? cacheState.settings : '');
    const catalogVersion = String(cacheState && cacheState.catalog ? cacheState.catalog : '');
    const pagesVersion = String(cacheState && cacheState.pages ? cacheState.pages : '');

    const requests = [
      { action: 'get_global_settings', cache_version: settingsVersion },
      { action: 'get_products', email: '', cache_version: catalogVersion },
      { action: 'get_pages', owner_id: '', cache_version: pagesVersion }
    ];

    const [settingsRes, productsRes, pagesRes] = await batchActions(requests);

    if (settingsRes && settingsRes.status === 'success' && settingsRes.data) {
      state.settings = { ...DEFAULT_SETTINGS, ...settingsRes.data };
    }

    state.products = extractProducts(productsRes);

    if (Array.isArray(state.products) && state.products.length) {
      const payload = {
        items: state.products,
        time: Date.now(),
        version: String(catalogVersion || '')
      };
      persistLocalStorage('cepat_public_catalog', JSON.stringify(payload));
    }
    state.pages = mapPages(pagesRes);
    state.pageMap = buildPageMap(state.pages);

    const cmsCandidates = [
      'home-block-highlight', 'home-highlight', 'about-block-mission', 'about-mission',
      'affiliate-block', 'affiliate-info', 'testimoni', 'customer-story',
      'faq', 'faq-block', 'faq-json', 'testimoni-json', 'testimonials-json'
    ];
    const missingCms = cmsCandidates.filter((slug) => !state.pageMap[slug]);
    if (missingCms.length) {
      const cmsResponses = await batchActions(
        missingCms.map((slug) => ({ action: 'get_page_content', slug, cache_version: pagesVersion }))
      );
      cmsResponses.forEach((entry, index) => {
        if (!entry || entry.status !== 'success') return;
        const slug = missingCms[index];
        state.pageMap[slug] = {
          slug,
          title: entry.title || '',
          content: entry.content || ''
        };
      });
    }

    if (PAGE === 'product') {
      const params = new URLSearchParams(window.location.search);
      const id = normalizeText(params.get('id'));
      const hasInList = id && state.products.some((product) => String(product.id) === id);
      if (id && !hasInList) {
        const detail = await postAction({ action: 'get_product', id, aff_id: state.ref, ref: state.ref, cache_version: catalogVersion });
        if (detail && detail.status === 'success' && detail.data) {
          state.products.unshift(detail.data);
        }
      }
    }
  }

  function runPageRender() {
    setActiveNav();
    applyBranding();
    injectCmsBlocks();

    if (PAGE === 'home') {
      renderProductCards('featured-products', state.products, 3);
      renderPackageTable('package-comparison', state.products);
      renderTestimonials('home-testimonials', 3);
      renderFaqs('home-faq', 3);
      syncStickyCta('products.html');
    }

    if (PAGE === 'products') {
      renderProductCards('products-grid', state.products, 0);
      renderPackageTable('products-package-comparison', state.products);
      syncStickyCta('products.html');
    }

    if (PAGE === 'product') {
      renderProductDetail();
    }

    if (PAGE === 'affiliate') {
      renderAffiliateTable();
      syncStickyCta('affiliate.html');
    }

    if (PAGE === 'testimonials') {
      renderTestimonials('testimonials-grid', 0);
      syncStickyCta('products.html');
    }

    if (PAGE === 'faq') {
      renderFaqs('faq-list', 0);
      syncStickyCta('contact.html');
    }

    if (PAGE === 'contact') {
      renderFaqs('contact-faq', 2);
      syncStickyCta('contact.html');
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  async function init() {
    try {
      await hydrateState();
    } catch (error) {
      state.settings = { ...DEFAULT_SETTINGS };
    }
    runPageRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
