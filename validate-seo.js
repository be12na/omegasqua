const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INDEX_PATH = path.join(ROOT, 'index.html');

function readFileSafe(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function parseTags(html, tagName) {
    const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
    const tags = [];
    let match;

    while ((match = pattern.exec(html))) {
        const attrs = {};
        const source = match[1] || '';
        source.replace(/([^\s=]+)\s*=\s*(['"])(.*?)\2/g, (_, key, __, value) => {
            attrs[String(key || '').toLowerCase()] = value;
            return '';
        });
        tags.push(attrs);
    }

    return tags;
}

function findMeta(metaTags, attrName, attrValue) {
    return metaTags.find((tag) => tag[attrName] === attrValue) || null;
}

function findLink(linkTags, relValue) {
    return linkTags.find((tag) => tag.rel === relValue) || null;
}

function resolveLocalAsset(assetUrl) {
    if (!assetUrl) return null;
    if (/^https?:\/\//i.test(assetUrl)) return null;
    const cleanUrl = assetUrl.split('#')[0].split('?')[0].replace(/^\.?\//, '');
    return path.join(ROOT, cleanUrl);
}

function readPngDimensions(buffer) {
    const pngSignature = '89504e470d0a1a0a';
    if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
        throw new Error('Bukan file PNG yang valid.');
    }
    if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
        throw new Error('Header IHDR PNG tidak ditemukan.');
    }
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
    };
}

function pushResult(collection, passed, label, detail) {
    collection.push({ passed, label, detail });
}

function main() {
    const results = [];
    const html = readFileSafe(INDEX_PATH);
    const metaTags = parseTags(html, 'meta');
    const linkTags = parseTags(html, 'link');

    const description = findMeta(metaTags, 'name', 'description');
    const ogTitle = findMeta(metaTags, 'property', 'og:title');
    const ogDescription = findMeta(metaTags, 'property', 'og:description');
    const ogImage = findMeta(metaTags, 'property', 'og:image');
    const ogImageType = findMeta(metaTags, 'property', 'og:image:type');
    const ogImageWidth = findMeta(metaTags, 'property', 'og:image:width');
    const ogImageHeight = findMeta(metaTags, 'property', 'og:image:height');
    const twitterCard = findMeta(metaTags, 'name', 'twitter:card');
    const twitterImage = findMeta(metaTags, 'name', 'twitter:image');
    const canonical = findLink(linkTags, 'canonical');

    pushResult(results, !!description && !!description.content, 'Meta description tersedia', description ? description.content : '');
    pushResult(
        results,
        !!description && String(description.content || '').length <= 160,
        'Meta description <= 160 karakter',
        description ? `${String(description.content || '').length} karakter` : 'Tidak ditemukan'
    );
    pushResult(results, !!ogTitle && !!ogTitle.content, 'og:title tersedia', ogTitle ? ogTitle.content : '');
    pushResult(results, !!ogDescription && !!ogDescription.content, 'og:description tersedia', ogDescription ? ogDescription.content : '');
    pushResult(results, !!ogImage && !!ogImage.content, 'og:image tersedia', ogImage ? ogImage.content : '');
    pushResult(results, !!twitterCard && twitterCard.content === 'summary_large_image', 'twitter:card summary_large_image', twitterCard ? twitterCard.content : '');
    pushResult(
        results,
        !!twitterImage && !!ogImage && twitterImage.content === ogImage.content,
        'twitter:image sinkron dengan og:image',
        twitterImage ? twitterImage.content : ''
    );
    pushResult(results, !!canonical && !!canonical.href, 'Canonical link tersedia', canonical ? canonical.href : '');
    pushResult(results, html.includes('window.CEPAT_SEO'), 'Generator SEO dinamis ditemukan', 'window.CEPAT_SEO');
    pushResult(results, html.includes('window.__SEO_DEBUG__'), 'SEO debug helper ditemukan', 'window.__SEO_DEBUG__');
    pushResult(results, html.includes('data-seo-title') && html.includes('data-seo-description'), 'Sumber konten SEO utama diberi marker', 'data-seo-title / data-seo-description');

    if (ogImage && ogImage.content) {
        const localAssetPath = resolveLocalAsset(ogImage.content);
        if (localAssetPath && fs.existsSync(localAssetPath)) {
            const imageBuffer = fs.readFileSync(localAssetPath);
            const stats = fs.statSync(localAssetPath);
            const dimensions = readPngDimensions(imageBuffer);
            const expectedWidth = Number((ogImageWidth && ogImageWidth.content) || 0);
            const expectedHeight = Number((ogImageHeight && ogImageHeight.content) || 0);

            pushResult(results, dimensions.width === 1200 && dimensions.height === 630, 'Fallback OG image berukuran 1200x630', `${dimensions.width}x${dimensions.height}`);
            pushResult(results, stats.size <= 1048576, 'Fallback OG image <= 1MB', `${stats.size} bytes`);
            pushResult(results, expectedWidth === dimensions.width, 'og:image:width sinkron dengan file', String(expectedWidth || ''));
            pushResult(results, expectedHeight === dimensions.height, 'og:image:height sinkron dengan file', String(expectedHeight || ''));
            pushResult(results, !!ogImageType && /image\/png/i.test(ogImageType.content || ''), 'og:image:type image/png', ogImageType ? ogImageType.content : '');
        } else {
            pushResult(results, false, 'Fallback OG image lokal ditemukan', localAssetPath || ogImage.content);
        }
    }

    const failed = results.filter((item) => !item.passed);
    console.log('SEO validation results for index.html');
    results.forEach((item) => {
        const prefix = item.passed ? 'PASS' : 'FAIL';
        console.log(`[${prefix}] ${item.label}${item.detail ? ` -> ${item.detail}` : ''}`);
    });

    if (failed.length) {
        console.error(`SEO validation failed with ${failed.length} issue(s).`);
        process.exit(1);
    }

    console.log('SEO validation passed.');
}

main();
