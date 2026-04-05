# OpenAI Timeout and Retry Policy

Policy ini dipakai untuk menghindari request macet sangat lama (contoh 1,200,000ms) dan menjaga orkestrasi sub-agent tetap stabil.

## Target Operasional

- Hard request timeout maksimal 240 detik.
- Retry adaptif dengan exponential backoff + jitter.
- Concurrency turun otomatis saat context budget naik.
- Circuit breaker aktif saat failure rate tinggi.

## Sumber Policy

- `.orchestrator/openai-request-policy.json`
- `.orchestrator/control-plane.yaml` pada blok `runtime_profiles` dan `reporting`

## Implementasi Singkat

1. Terapkan timeout berlapis: `connect_ms`, `first_token_ms`, `completion_ms`, `hard_request_ms`.
2. Retry hanya untuk error transient (`429`, `5xx`, timeout, network reset).
3. Saat context masuk yellow/red band, kurangi jumlah sub-agent aktif otomatis.
4. Jika failure rate > 25% dalam 5 menit, buka circuit breaker 60 detik.

## SDK Mapping (Node.js)

```js
const policy = {
  hardRequestMs: 240000,
  maxAttempts: 4,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000
};

function computeBackoff(attempt) {
  const exp = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** (attempt - 1));
  return Math.floor(Math.random() * exp);
}
```

## Monitoring Wajib

- Kirim heartbeat per 30 detik.
- Tandai shard stale jika > 60 detik tanpa update.
- Eskalasi kritis jika > 90 detik tanpa update.
- Laporkan KPI: `p95_latency_ms`, `failure_rate_pct_5m`, `timeout_count_5m`, `context_budget_pct`.

## Guardrail Context

- Green `< 50%`: dispatch normal.
- Yellow `50-60%`: throttle dispatch.
- Red `> 60%`: pause non-critical.
- Emergency `> 70%`: stop dispatch baru dan jalankan grooming segera.
