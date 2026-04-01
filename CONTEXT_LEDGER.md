# Omegasqua Refactor Context Ledger

## Session Objective
Refactor existing website stack (static frontend + Cloudflare Worker + Apps Script backend + admin shell) into an **Affiliate Herbal Supplement Website** for **Omegasqua** without rebuilding from scratch.

## Preserved Architecture (Keep)
- Public static pages with API-driven dynamic content.
- `config.js` transport layer (retry, cache, dedupe, batch API support).
- `_worker.js` as edge API/webhook/caching/routing control plane.
- `appscript.js` `doPost` action router style + admin session checks.
- Existing admin SPA shell (`admin-area.html`) and member area shell (`dashboard.html`) patterns.

## High-Risk Shared Files (Single-owner discipline)
- `_worker.js`: routing/circuit/cache/metrics choke point.
- `appscript.js`: action switch + auth/cache/logging helpers.
- `site.config.js` + `wrangler.jsonc`: origin/domain drift risk.

## Existing Contract Notes
- Frontend sends POST JSON `{ action, ... }` to `/api` (or Script URL fallback).
- Batch contract: `{ action:'batch', requests:[...] }`.
- Worker forwards and normalizes response metadata.
- AppScript routes by exact `action` names.

## Refactor Target Domains
1. Products + product detail enrichment (benefits, ingredients, compliance).
2. Package tiers + affiliate commission by tier.
3. Testimonials + FAQs.
4. Inquiries/leads + affiliate/reseller/agent interest.
5. CMS pages and site settings for editable public content blocks.

## Context Hygiene Policy (50% Budget)
- Distill high-signal outputs before pruning raw tool output.
- Prune noisy/failed/superseded outputs first.
- Keep only implementation-critical raw reads; re-read files on demand for line-accurate edits.
- Persist key session findings in this ledger for recovery.

## Cleanup Candidates (Non-destructive guidance)
- Archive/exclude dev-only artifacts when needed: `node_modules/`, `tests/`, `token-usage-output.txt`, build-only scripts.
- Do not remove runtime-relevant scripts used by active pages.

## Active Parallel Workstreams
- Backend entity/API refactor task (implementation category).
- Public conversion site refactor task (visual-engineering category).
- Admin dashboard refactor task (visual-engineering category).
