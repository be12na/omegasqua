# Omegasqua Refactor Mapping

## Keep (Preserve)
- `_worker.js` edge gateway pattern (`/api`, webhook, cache/circuit/rate control)
- `config.js` API abstraction (retry, dedupe, cache, batch)
- `appscript.js` action-based router and admin session guard model
- Existing static-page deployment model and asset/layout baseline
- Admin auth shell and dashboard scaffold in `admin-area.html`

## Revise (Adapt)
- `index.html`: from digital-course landing page to herbal conversion homepage
- `dashboard.html`: from member material area to affiliate/reseller operational dashboard
- `admin-area.html`: rename and rewire modules to products/packages/testimonials/faqs/inquiries/cms/settings/affiliates
- `get_global_settings` payload to include trust badges, CTA, compliance/disclaimer, contact channels
- Existing product model to support slug, benefits, ingredients, package tiers, commission fields

## Replace (Business-domain mismatch)
- Legacy labels/content tied to old digital business
- Irrelevant CTA flows (course purchase/member access semantics)
- Legacy schema fields that no longer map to herbal affiliate operations

## Remove (No longer relevant)
- Public copy blocks and filters that are unrelated to supplements/affiliates
- Admin modules that do not support product/package/content/lead operations

## New/Extended Domains
- Products
- Product Benefits
- Product Ingredients
- Product Packages
- Testimonials
- FAQs
- Inquiries/Leads
- Affiliates
- CMS Pages
- Site Settings

## Target Public Pages
- Home
- About
- Products Listing
- Product Detail
- Affiliate/Partnership
- Testimonials
- FAQ
- Contact

## Target Admin Modules
- Overview
- Products
- Product Packages
- Testimonials
- FAQs
- Landing/CMS
- Inquiries/Leads
- Affiliates
- Site Settings
