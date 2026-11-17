#!/usr/bin/env node
/**
 * Reproducible Staging Load-Test Runner for PING BY DOT
 *
 * Tests concurrent read throughput & latency across:
 *   1. TanStack Start SSR routes (/, /explore, /hubs, /signals/channels)
 *   2. Supabase PostgREST queries backed by 0022 partial indexes (pings, hubs, signals)
 *
 * Safety guardrails:
 *   - Read-only HTTP GET checks only (never mutates database records).
 *   - Blocks high-concurrency runs (> 5 VUs) against live production project
 *     `exlttyafomvqfwgzzjrm` or `pingbydot.lovable.app` unless an explicit
 *     staging target is supplied or `--allow-prod-smoke` (max 5 VUs) is set.
 */

import process from "node:process";

function parseArgs(argv) {
  const args = {
    appUrl: "http://127.0.0.1:4173",
    supabaseUrl: process.env.VITE_SUPABASE_URL || "",
    anonKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    wave: "baseline",
    concurrency: 25,
    duration: 20,
    allowProdSmoke: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--app-url" && next) {
      args.appUrl = next.replace(/\/$/, "");
      i += 1;
    } else if (token === "--supabase-url" && next) {
      args.supabaseUrl = next.replace(/\/$/, "");
      i += 1;
    } else if (token === "--anon-key" && next) {
      args.anonKey = next;
      i += 1;
    } else if (token === "--wave" && next) {
      args.wave = next;
      i += 1;
    } else if (token === "--concurrency" && next) {
      args.concurrency = Math.max(1, Math.min(500, Number(next) || 25));
      i += 1;
    } else if (token === "--duration" && next) {
      args.duration = Math.max(5, Math.min(600, Number(next) || 20));
      i += 1;
    } else if (token === "--allow-prod-smoke") {
      args.allowProdSmoke = true;
    }
  }
  return args;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const targetsProdHost =
    opts.appUrl.includes("pingbydot.lovable.app") ||
    opts.supabaseUrl.includes("exlttyafomvqfwgzzjrm.supabase.co");

  if (targetsProdHost && (!opts.allowProdSmoke || opts.concurrency > 5)) {
    console.error(
      "SAFETY BLOCK: High-concurrency load testing against production is blocked.\n" +
        "Point --app-url and --supabase-url to a staging environment, or pass\n" +
        "--allow-prod-smoke with --concurrency <= 5 for lightweight read-only smoke verification.",
    );
    process.exit(2);
  }

  const endpoints = [
    { name: "SSR /", url: `${opts.appUrl}/`, headers: {} },
    { name: "SSR /explore", url: `${opts.appUrl}/explore`, headers: {} },
    { name: "SSR /hubs", url: `${opts.appUrl}/hubs`, headers: {} },
    { name: "SSR /signals/channels", url: `${opts.appUrl}/signals/channels`, headers: {} },
  ];

  if (opts.supabaseUrl && opts.anonKey) {
    const restHeaders = {
      apikey: opts.anonKey,
      Authorization: `Bearer ${opts.anonKey}`,
    };
    endpoints.push(
      {
        name: "REST pings feed",
        url: `${opts.supabaseUrl}/rest/v1/pings?select=id,user_id,category,content,created_at&hidden_at=is.null&order=created_at.desc&limit=30`,
        headers: restHeaders,
      },
      {
        name: "REST hubs directory",
        url: `${opts.supabaseUrl}/rest/v1/hubs?select=id,slug,name,category,member_count&access=eq.public&limit=24`,
        headers: restHeaders,
      },
      {
        name: "REST signals directory",
        url: `${opts.supabaseUrl}/rest/v1/signals?select=id,slug,name,verified,follower_count&order=follower_count.desc&limit=24`,
        headers: restHeaders,
      },
    );
  }

  console.log(
    JSON.stringify(
      {
        phase: "start",
        wave: opts.wave,
        concurrency: opts.concurrency,
        durationSeconds: opts.duration,
        endpointCount: endpoints.length,
        appUrl: opts.appUrl,
        supabaseConfigured: Boolean(opts.supabaseUrl && opts.anonKey),
      },
      null,
      2,
    ),
  );

  const deadline = Date.now() + opts.duration * 1000;
  const stats = new Map(
    endpoints.map((ep) => [
      ep.name,
      { requests: 0, ok: 0, failures: 0, statuses: {}, latenciesMs: [] },
    ]),
  );

  let rr = 0;
  async function worker() {
    while (Date.now() < deadline) {
      const ep = endpoints[rr % endpoints.length];
      rr += 1;
      const bucket = stats.get(ep.name);
      const t0 = performance.now();
      try {
        const res = await fetch(ep.url, {
          method: "GET",
          headers: ep.headers,
          signal: AbortSignal.timeout(10000),
        });
        const elapsed = performance.now() - t0;
        bucket.requests += 1;
        bucket.latenciesMs.push(elapsed);
        bucket.statuses[res.status] = (bucket.statuses[res.status] || 0) + 1;
        await res.arrayBuffer();
        if (res.status >= 200 && res.status < 400) {
          bucket.ok += 1;
        } else {
          bucket.failures += 1;
        }
      } catch (err) {
        const elapsed = performance.now() - t0;
        bucket.requests += 1;
        bucket.failures += 1;
        bucket.latenciesMs.push(elapsed);
        const key = err instanceof Error ? err.name : "NetworkError";
        bucket.statuses[key] = (bucket.statuses[key] || 0) + 1;
      }
    }
  }

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  const totalSec = Math.max(0.001, (performance.now() - startedAt) / 1000);

  let totalRequests = 0;
  let totalFailures = 0;
  const report = {};

  for (const [name, s] of stats.entries()) {
    s.latenciesMs.sort((a, b) => a - b);
    totalRequests += s.requests;
    totalFailures += s.failures;
    report[name] = {
      requests: s.requests,
      ok: s.ok,
      failures: s.failures,
      rps: Number((s.requests / totalSec).toFixed(2)),
      p50Ms: Number(percentile(s.latenciesMs, 50).toFixed(1)),
      p95Ms: Number(percentile(s.latenciesMs, 95).toFixed(1)),
      p99Ms: Number(percentile(s.latenciesMs, 99).toFixed(1)),
      statuses: s.statuses,
    };
  }

  const errorRatePct = totalRequests > 0 ? (totalFailures / totalRequests) * 100 : 100;
  const summary = {
    wave: opts.wave,
    elapsedSec: Number(totalSec.toFixed(2)),
    totalRequests,
    totalFailures,
    errorRatePct: Number(errorRatePct.toFixed(2)),
    aggregateRps: Number((totalRequests / totalSec).toFixed(2)),
    endpoints: report,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (errorRatePct > 1.0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
