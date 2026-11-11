var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../etf-flow-core.ts
var DEFAULT_ETF_CODE = "510300";
var DEFAULT_ETF_NAME = "\u6CAA\u6DF1300ETF\u534E\u6CF0\u67CF\u745E";
var DEFAULT_ETF_SECID = "1.510300";
var ETF_KLINE_FULL_LIMIT = 1e5;
async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  }
  __name(run, "run");
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
  return out;
}
__name(mapPool, "mapPool");
function emptyCache() {
  return { closes: {}, shares: {} };
}
__name(emptyCache, "emptyCache");
function selectShareFetchDates(klineDates, cachedShares, opts) {
  const backfillLimit = opts?.backfillLimit ?? 40;
  const retryRecent = opts?.retryRecent ?? 8;
  const missing = klineDates.filter((d) => {
    const v = cachedShares[d];
    return !(typeof v === "number" && Number.isFinite(v));
  });
  if (!missing.length) return [];
  const cachedKeys = Object.keys(cachedShares).filter((d) => typeof cachedShares[d] === "number" && Number.isFinite(cachedShares[d])).sort();
  const lastCached = cachedKeys.length ? cachedKeys[cachedKeys.length - 1] : null;
  const recentSet = new Set(klineDates.slice(-retryRecent));
  const incremental = lastCached ? missing.filter((d) => d > lastCached) : [];
  const recentRetry = missing.filter((d) => recentSet.has(d));
  const historical = missing.filter((d) => !recentSet.has(d) && !(lastCached && d > lastCached));
  const backfill = historical.slice(0, Math.max(0, backfillLimit));
  return [.../* @__PURE__ */ new Set([...incremental, ...recentRetry, ...backfill])].sort();
}
__name(selectShareFetchDates, "selectShareFetchDates");
async function buildEtfFlowSeries(opts, deps) {
  const code = opts.code || DEFAULT_ETF_CODE;
  const name = opts.name || DEFAULT_ETF_NAME;
  const secid = opts.secid || DEFAULT_ETF_SECID;
  const concurrency = deps.concurrency ?? 8;
  const backfillLimit = deps.backfillLimit ?? 40;
  const retryRecent = deps.retryRecent ?? 8;
  const cache = await deps.loadCache(code);
  cache.closes = cache.closes ?? {};
  cache.shares = cache.shares ?? {};
  const klines = await deps.fetchKlines(secid, ETF_KLINE_FULL_LIMIT);
  if (klines.length < 2) {
    throw new Error("ETF \u65E5\u7EBF\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u8BA1\u7B97\u51C0\u6D41\u5165");
  }
  let closesDirty = false;
  for (const row of klines) {
    if (cache.closes[row.date] !== row.close) {
      cache.closes[row.date] = row.close;
      closesDirty = true;
    }
  }
  const klineDates = klines.map((k) => k.date);
  const toFetch = selectShareFetchDates(klineDates, cache.shares, {
    backfillLimit,
    retryRecent
  });
  let fetchedShareCount = 0;
  const pendingDates = [];
  if (toFetch.length) {
    await mapPool(toFetch, concurrency, async (date) => {
      const wan = await deps.fetchShareWan(code, date);
      if (wan == null || !Number.isFinite(wan)) {
        pendingDates.push(date);
        return;
      }
      cache.shares[date] = wan;
      fetchedShareCount += 1;
    });
  }
  const stillMissing = klineDates.filter((d) => {
    const v = cache.shares[d];
    return !(typeof v === "number" && Number.isFinite(v));
  });
  if (closesDirty || fetchedShareCount > 0) {
    cache.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    cache.code = code;
    await deps.saveCache(code, cache);
  }
  let cacheHitShareCount = 0;
  const series = [];
  for (let i = 0; i < klines.length; i++) {
    const { date, close } = klines[i];
    const shareWan = cache.shares[date];
    if (!(typeof shareWan === "number" && Number.isFinite(shareWan))) continue;
    if (!toFetch.includes(date)) cacheHitShareCount += 1;
    let netInflowYi = null;
    if (i > 0) {
      const prev = klines[i - 1];
      const prevShare = cache.shares[prev.date];
      if (typeof prevShare === "number" && Number.isFinite(prevShare)) {
        netInflowYi = Math.round((shareWan - prevShare) * 1e4 * close / 1e8 * 100) / 100;
      }
    }
    series.push({ date, close, shareWan, netInflowYi });
  }
  const last = series[series.length - 1];
  return {
    code,
    name,
    asOf: last?.date ?? klines[klines.length - 1].date,
    latestNetInflowYi: last?.netInflowYi ?? null,
    latestShareWan: last?.shareWan ?? null,
    series,
    pendingDates: [...new Set(pendingDates)].sort(),
    missingShareCount: stillMissing.length,
    fetchedShareCount,
    cacheHitShareCount,
    note: "\u51C0\u6D41\u5165 \u2248 \u65E5\u4EFD\u989D\u53D8\u52A8 \xD7 \u6536\u76D8\u4EF7\u3002\u4EFD\u989D/\u6536\u76D8\u4EF7\u4F18\u5148\u8BFB\u672C\u5730\u7F13\u5B58\uFF1B\u65E5\u5E38\u53EA\u8865\u7F3A\u65E5\u4E0E\u8FD1\u7AEF T+1 \u91CD\u8BD5\u3002\u5355\u53EA ETF \u7533\u8D4E\u51C0\u989D\u4E3A\u5927\u8D44\u91D1\u4EE3\u7406\u6307\u6807\uFF0C\u975E\u5B98\u65B9\u300C\u56FD\u5BB6\u961F\u300D\u53E3\u5F84\u3002"
  };
}
__name(buildEtfFlowSeries, "buildEtfFlowSeries");
function parseEmKlines(payload) {
  const lines = payload.data?.klines ?? [];
  const out = [];
  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const date = parts[0];
    const close = Number(parts[2]);
    if (!date || !Number.isFinite(close)) continue;
    out.push({ date, close });
  }
  return out;
}
__name(parseEmKlines, "parseEmKlines");
function parseSseShareWan(payload, code) {
  const rows = payload.result ?? [];
  const hit = rows.find((r) => r.SEC_CODE === code);
  if (!hit?.TOT_VOL) return null;
  const wan = Number(hit.TOT_VOL);
  return Number.isFinite(wan) ? wan : null;
}
__name(parseSseShareWan, "parseSseShareWan");
function normalizeCache(raw) {
  if (!raw || typeof raw !== "object") return emptyCache();
  const obj = raw;
  const closes = obj.closes && typeof obj.closes === "object" ? obj.closes : {};
  const shares = obj.shares && typeof obj.shares === "object" ? obj.shares : {};
  return {
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : void 0,
    code: typeof obj.code === "string" ? obj.code : void 0,
    closes,
    shares
  };
}
__name(normalizeCache, "normalizeCache");

// ../margin-series-core.ts
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
__name(sleep, "sleep");
function toCompact(date) {
  return date.replace(/-/g, "");
}
__name(toCompact, "toCompact");
function normalizeMarginCache(raw) {
  if (!raw || typeof raw !== "object") return { days: {} };
  const obj = raw;
  const days = obj.days && typeof obj.days === "object" ? obj.days : {};
  return {
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : void 0,
    days
  };
}
__name(normalizeMarginCache, "normalizeMarginCache");
async function buildMarginSeries(deps) {
  const refreshRecent = deps.refreshRecent ?? 5;
  const pageSize = deps.pageSize ?? 800;
  const cache = await deps.loadCache();
  cache.days = cache.days ?? {};
  const cachedDates = Object.keys(cache.days).sort();
  const lastCached = cachedDates.length ? cachedDates[cachedDates.length - 1] : null;
  const refreshFrom = cachedDates.length > 0 ? cachedDates[Math.max(0, cachedDates.length - refreshRecent)] : null;
  let fetchedMarginDays = 0;
  let page = 1;
  let pages = 1;
  let stop = false;
  while (!stop && page <= pages) {
    const batch = await deps.fetchMarginPage(page, pageSize);
    pages = Math.max(1, batch.pages || 1);
    if (!batch.rows.length) break;
    for (const row of batch.rows) {
      const date = String(row.DIM_DATE).slice(0, 10);
      if (!date) continue;
      const next = {
        marginYi: Math.round(Number(row.RZRQYE) / 1e8 * 100) / 100,
        financingYi: Math.round(Number(row.RZYE) / 1e8 * 100) / 100,
        securitiesYi: Math.round(Number(row.RQYE) / 1e8 * 100) / 100,
        sseClose: cache.days[date]?.sseClose ?? null
      };
      const prev = cache.days[date];
      const same = prev && prev.marginYi === next.marginYi && prev.financingYi === next.financingYi && prev.securitiesYi === next.securitiesYi;
      if (!same) {
        cache.days[date] = next;
        fetchedMarginDays += 1;
      }
      if (refreshFrom && date < refreshFrom && lastCached) {
        stop = true;
      }
    }
    if (stop) break;
    if (page >= pages) break;
    if (lastCached && batch.rows.length) {
      const oldest = String(batch.rows[batch.rows.length - 1]?.DIM_DATE || "").slice(0, 10);
      if (refreshFrom && oldest && oldest < refreshFrom) stop = true;
    }
    page += 1;
    if (!stop) await sleep(180);
  }
  const allDates = Object.keys(cache.days).sort();
  const end = /* @__PURE__ */ new Date();
  const endCompact = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, "0")}${String(end.getDate()).padStart(2, "0")}`;
  let sseStart = "20100101";
  if (allDates.length) {
    const withClose = allDates.filter((d) => cache.days[d]?.sseClose != null);
    if (withClose.length) {
      const refreshIdx = Math.max(0, withClose.length - refreshRecent);
      sseStart = toCompact(withClose[refreshIdx]);
    } else {
      sseStart = toCompact(allDates[0]);
    }
  }
  const sseMap = await deps.fetchSseCloseMap(sseStart, endCompact);
  let fetchedSseDays = 0;
  for (const [date, close] of sseMap) {
    const day = cache.days[date];
    if (!day) continue;
    if (day.sseClose !== close) {
      day.sseClose = close;
      fetchedSseDays += 1;
    }
  }
  if (fetchedMarginDays > 0 || fetchedSseDays > 0 || !cache.updatedAt) {
    cache.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await deps.saveCache(cache);
  }
  const series = Object.entries(cache.days).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length) throw new Error("\u4E24\u878D\u7F13\u5B58\u4E3A\u7A7A\uFF0C\u8BF7\u68C0\u67E5\u4E1C\u8D22\u63A5\u53E3\u6216\u5148 seed");
  return {
    series,
    asOf: series[series.length - 1].date,
    fetchedMarginDays,
    fetchedSseDays,
    cacheHitDays: Math.max(0, series.length - fetchedMarginDays),
    note: "\u4E24\u878D\u4F18\u5148\u8BFB\u672C\u5730/KV\uFF1B\u65E5\u5E38\u4E1C\u8D22\u5012\u5E8F\u5206\u9875\u81F3\u7F13\u5B58\u91CD\u53E0\u5904\u65E9\u505C\uFF0C\u4E0A\u8BC1\u7528\u641C\u72D0\u65E5\u671F\u7A97\u53E3\u589E\u91CF\u3002"
  };
}
__name(buildMarginSeries, "buildMarginSeries");

// ../turnover-series-core.ts
function toCompact2(date) {
  return date.replace(/-/g, "");
}
__name(toCompact2, "toCompact");
function sleep2(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
__name(sleep2, "sleep");
function normalizeTurnoverCache(raw) {
  if (!raw || typeof raw !== "object") return { days: {} };
  const obj = raw;
  const days = obj.days && typeof obj.days === "object" ? obj.days : {};
  return {
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : void 0,
    days
  };
}
__name(normalizeTurnoverCache, "normalizeTurnoverCache");
async function buildTurnoverSeries(deps) {
  const fullStart = deps.fullStart || "20150101";
  const refreshRecent = deps.refreshRecent ?? 5;
  const cache = await deps.loadCache();
  cache.days = cache.days ?? {};
  const cachedDates = Object.keys(cache.days).sort();
  const end = /* @__PURE__ */ new Date();
  const endCompact = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, "0")}${String(end.getDate()).padStart(2, "0")}`;
  let startCompact = fullStart;
  if (cachedDates.length) {
    const last = cachedDates[cachedDates.length - 1];
    const refreshFromIdx = Math.max(0, cachedDates.length - refreshRecent);
    const refreshFrom = cachedDates[refreshFromIdx];
    startCompact = toCompact2(refreshFrom <= last ? refreshFrom : last);
  }
  const shMap = await deps.fetchIndexAmount("zs_000001", startCompact, endCompact);
  await sleep2(200);
  const szMap = await deps.fetchIndexAmount("zs_399001", startCompact, endCompact);
  let fetchedDays = 0;
  const dates = [...shMap.keys()].filter((d) => szMap.has(d)).sort();
  for (const date of dates) {
    const amountYi = Math.round(((shMap.get(date) ?? 0) + (szMap.get(date) ?? 0)) * 10) / 10;
    const prev = cache.days[date]?.amountYi;
    if (prev !== amountYi) {
      cache.days[date] = { amountYi };
      fetchedDays += 1;
    }
  }
  if (fetchedDays > 0 || !cache.updatedAt) {
    cache.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await deps.saveCache(cache);
  }
  const series = Object.entries(cache.days).map(([date, v]) => ({ date, amountYi: v.amountYi })).sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 2) throw new Error("\u6210\u4EA4\u989D\u7F13\u5B58\u4E3A\u7A7A\uFF0C\u8BF7\u68C0\u67E5\u641C\u72D0\u63A5\u53E3\u6216\u5148 seed");
  const cacheHitDays = Math.max(0, series.length - fetchedDays);
  return {
    series,
    asOf: series[series.length - 1].date,
    fetchedDays,
    cacheHitDays,
    note: "\u6210\u4EA4\u989D\u4F18\u5148\u8BFB\u672C\u5730/KV\uFF1B\u65E5\u5E38\u4EC5\u7528\u641C\u72D0 hisHq \u6309 start/end \u589E\u91CF\u7A97\u53E3\u62C9\u53D6\u5E76\u5408\u5E76\u3002"
  };
}
__name(buildTurnoverSeries, "buildTurnoverSeries");

// src/index.ts
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var PROXY_RULES = [
  {
    prefix: "/api/sohu",
    origin: "https://q.stock.sohu.com",
    strip: "/api/sohu",
    headers: { Referer: "https://q.stock.sohu.com/", "User-Agent": UA }
  },
  {
    prefix: "/api/sina",
    origin: "https://hq.sinajs.cn",
    strip: "/api/sina",
    headers: { Referer: "https://finance.sina.com.cn", "User-Agent": UA }
  },
  // emdc 必须在 eastmoney 之前（前缀更长）
  {
    prefix: "/api/emdc",
    origin: "https://datacenter-web.eastmoney.com",
    strip: "/api/emdc",
    headers: { Referer: "https://data.eastmoney.com/rzrq/", "User-Agent": UA }
  },
  {
    prefix: "/api/eastmoney",
    origin: "https://push2his.eastmoney.com",
    strip: "/api/eastmoney",
    headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": UA }
  }
];
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
__name(json, "json");
function corsPass(res) {
  const out = new Response(res.body, res);
  out.headers.set("Access-Control-Allow-Origin", "*");
  return out;
}
__name(corsPass, "corsPass");
async function proxyRequest(request, rule) {
  const incoming = new URL(request.url);
  const upstreamPath = incoming.pathname.slice(rule.strip.length) || "/";
  const dest = new URL(upstreamPath + incoming.search, rule.origin);
  const headers = new Headers(rule.headers);
  const init = {
    method: request.method,
    headers,
    redirect: "follow"
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  const res = await fetch(dest.toString(), init);
  return corsPass(res);
}
__name(proxyRequest, "proxyRequest");
function dayKey(date) {
  return `day:${date}`;
}
__name(dayKey, "dayKey");
async function handleIntradayArchive(request, env) {
  const kv = env.INTRADAY_KV;
  if (!kv) {
    return json(
      {
        message: "INTRADAY_KV \u672A\u7ED1\u5B9A\uFF1A\u4EE3\u7406\u53EF\u7528\uFF0C\u4F46\u4E91\u7AEF\u5206\u65F6\u5F52\u6863\u4E0D\u53EF\u7528\u3002\u8BF7\u6309 DEPLOY-CLOUDFLARE.md \u521B\u5EFA KV\u3002"
      },
      503
    );
  }
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") {
    return json({ ok: true });
  }
  if (request.method === "GET" && pathname === "/api/local/intraday") {
    const listed = await kv.list({ prefix: "day:" });
    const dates = listed.keys.map((k) => k.name.replace(/^day:/, "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return json({ dates });
  }
  if (request.method === "GET" && pathname === "/api/local/intraday/all") {
    const listed = await kv.list({ prefix: "day:" });
    const days = {};
    for (const key2 of listed.keys) {
      const date2 = key2.name.replace(/^day:/, "");
      const raw = await kv.get(key2.name);
      if (raw) {
        try {
          days[date2] = JSON.parse(raw);
        } catch {
        }
      }
    }
    return json({ days });
  }
  const match = pathname.match(/^\/api\/local\/intraday\/(\d{4}-\d{2}-\d{2})$/);
  if (!match) return json({ message: "not found" }, 404);
  const date = match[1];
  const key = dayKey(date);
  if (request.method === "GET") {
    const raw = await kv.get(key);
    if (!raw) return json({ message: `no archive for ${date}` }, 404);
    return new Response(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  if (request.method === "PUT") {
    const body = await request.json();
    if (body.date !== date || !body.minutes) {
      return json({ message: "invalid payload" }, 400);
    }
    const payload = {
      date,
      updatedAt: body.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
      minutes: body.minutes,
      totalYi: body.totalYi ?? 0
    };
    await kv.put(key, JSON.stringify(payload));
    return json({ ok: true, date });
  }
  return json({ message: "method not allowed" }, 405);
}
__name(handleIntradayArchive, "handleIntradayArchive");
function etfCacheKey(code) {
  return `etfcache:${code}`;
}
__name(etfCacheKey, "etfCacheKey");
async function handleEtfFlow(request, env) {
  if (request.method !== "GET") return json({ message: "method not allowed" }, 405);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || DEFAULT_ETF_CODE;
  const backfillLimit = Number(url.searchParams.get("backfill") || "40");
  const kv = env.INTRADAY_KV;
  try {
    const result = await buildEtfFlowSeries(
      { code, name: DEFAULT_ETF_NAME, secid: DEFAULT_ETF_SECID },
      {
        concurrency: 8,
        backfillLimit: Number.isFinite(backfillLimit) ? backfillLimit : 40,
        retryRecent: 8,
        async fetchKlines(secid, limit) {
          const dest = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&beg=0&end=20500101&lmt=${limit || ETF_KLINE_FULL_LIMIT}`;
          const r = await fetch(dest, {
            headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": UA }
          });
          if (!r.ok) throw new Error(`ETF \u65E5\u7EBF\u8BF7\u6C42\u5931\u8D25: ${r.status}`);
          return parseEmKlines(await r.json());
        },
        async fetchShareWan(etfCode, date) {
          const qs = new URLSearchParams({
            isPagination: "true",
            "pageHelp.pageSize": "10000",
            "pageHelp.pageNo": "1",
            "pageHelp.beginPage": "1",
            "pageHelp.cacheSize": "1",
            "pageHelp.endPage": "1",
            sqlId: "COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L",
            STAT_DATE: date
          });
          const r = await fetch(`https://query.sse.com.cn/commonQuery.do?${qs}`, {
            headers: { Referer: "https://www.sse.com.cn/", "User-Agent": UA }
          });
          if (!r.ok) return null;
          return parseSseShareWan(
            await r.json(),
            etfCode
          );
        },
        async loadCache(etfCode) {
          if (!kv) return normalizeCache(null);
          const raw = await kv.get(etfCacheKey(etfCode));
          if (!raw) return normalizeCache(null);
          try {
            return normalizeCache(JSON.parse(raw));
          } catch {
            return normalizeCache(null);
          }
        },
        async saveCache(etfCode, cache) {
          if (!kv) return;
          await kv.put(
            etfCacheKey(etfCode),
            JSON.stringify({
              updatedAt: cache.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
              code: etfCode,
              closes: cache.closes,
              shares: cache.shares
            })
          );
        }
      }
    );
    return json(result);
  } catch (e) {
    return json({ message: e instanceof Error ? e.message : String(e) }, 502);
  }
}
__name(handleEtfFlow, "handleEtfFlow");
async function fetchSohuAmount(code, start, end) {
  const url = `https://q.stock.sohu.com/hisHq?code=${code}&start=${start}&end=${end}&stat=1&order=A&period=d`;
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Referer: "https://q.stock.sohu.com/", "User-Agent": UA }
      });
      if (!res.ok) throw new Error(`sohu ${code}: ${res.status}`);
      const data = await res.json();
      const item = data?.[0];
      if (!item || item.status !== 0 || !item.hq?.length) throw new Error(`sohu ${code}: empty`);
      const map = /* @__PURE__ */ new Map();
      for (const row of item.hq) map.set(row[0], Number(row[8]) / 1e4);
      return map;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
__name(fetchSohuAmount, "fetchSohuAmount");
async function fetchSohuCloseMap(start, end) {
  const url = `https://q.stock.sohu.com/hisHq?code=zs_000001&start=${start}&end=${end}&stat=1&order=A&period=d`;
  const res = await fetch(url, {
    headers: { Referer: "https://q.stock.sohu.com/", "User-Agent": UA }
  });
  if (!res.ok) throw new Error(`\u4E0A\u8BC1\u6307\u6570\u8BF7\u6C42\u5931\u8D25: ${res.status}`);
  const data = await res.json();
  const map = /* @__PURE__ */ new Map();
  const item = data?.[0];
  if (!item || item.status !== 0 || !item.hq?.length) return map;
  for (const row of item.hq) map.set(row[0], Number(row[2]));
  return map;
}
__name(fetchSohuCloseMap, "fetchSohuCloseMap");
async function handleTurnoverSeries(env) {
  const kv = env.INTRADAY_KV;
  const key = "series:turnover";
  try {
    const result = await buildTurnoverSeries({
      fetchIndexAmount: fetchSohuAmount,
      async loadCache() {
        if (!kv) return normalizeTurnoverCache(null);
        const raw = await kv.get(key);
        return normalizeTurnoverCache(raw ? JSON.parse(raw) : null);
      },
      async saveCache(cache) {
        if (!kv) return;
        await kv.put(key, JSON.stringify(cache));
      }
    });
    return json(result);
  } catch (e) {
    return json({ message: e instanceof Error ? e.message : String(e) }, 502);
  }
}
__name(handleTurnoverSeries, "handleTurnoverSeries");
async function handleMarginSeries(env) {
  const kv = env.INTRADAY_KV;
  const key = "series:margin";
  try {
    const result = await buildMarginSeries({
      async fetchMarginPage(pageNumber, pageSize = 800) {
        const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ&columns=DIM_DATE,RZRQYE,RZYE,RQYE&pageNumber=${pageNumber}&pageSize=${pageSize}&sortTypes=-1&sortColumns=DIM_DATE&source=WEB&client=WEB`;
        const res = await fetch(url, {
          headers: { Referer: "https://data.eastmoney.com/rzrq/", "User-Agent": UA }
        });
        if (!res.ok) throw new Error(`\u4E24\u878D\u4F59\u989D\u8BF7\u6C42\u5931\u8D25: ${res.status}`);
        const body = await res.json();
        return { rows: body.result?.data ?? [], pages: body.result?.pages ?? 1 };
      },
      fetchSseCloseMap: fetchSohuCloseMap,
      async loadCache() {
        if (!kv) return normalizeMarginCache(null);
        const raw = await kv.get(key);
        return normalizeMarginCache(raw ? JSON.parse(raw) : null);
      },
      async saveCache(cache) {
        if (!kv) return;
        await kv.put(key, JSON.stringify(cache));
      }
    });
    return json(result);
  } catch (e) {
    return json({ message: e instanceof Error ? e.message : String(e) }, 502);
  }
}
__name(handleMarginSeries, "handleMarginSeries");
async function handleApi(request, env) {
  const pathname = new URL(request.url).pathname;
  if (request.method === "OPTIONS") {
    return json({ ok: true });
  }
  if (pathname.startsWith("/api/local/intraday")) {
    return handleIntradayArchive(request, env);
  }
  if (pathname === "/api/etf/flow") {
    return handleEtfFlow(request, env);
  }
  if (pathname === "/api/turnover/series") {
    if (request.method !== "GET") return json({ message: "method not allowed" }, 405);
    return handleTurnoverSeries(env);
  }
  if (pathname === "/api/margin/series") {
    if (request.method !== "GET") return json({ message: "method not allowed" }, 405);
    return handleMarginSeries(env);
  }
  const rule = PROXY_RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (rule) {
    try {
      return await proxyRequest(request, rule);
    } catch (e) {
      return json(
        { message: e instanceof Error ? e.message : "upstream proxy failed" },
        502
      );
    }
  }
  return json({ message: `no api route for ${pathname}` }, 404);
}
__name(handleApi, "handleApi");
var index_default = {
  async fetch(request, env) {
    return handleApi(request, env);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
