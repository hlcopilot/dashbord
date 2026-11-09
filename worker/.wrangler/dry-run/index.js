var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../etf-flow-core.ts
var DEFAULT_ETF_CODE = "510300";
var DEFAULT_ETF_NAME = "\u6CAA\u6DF1300ETF\u534E\u6CF0\u67CF\u745E";
var DEFAULT_ETF_SECID = "1.510300";
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
async function buildEtfFlowSeries(opts, deps) {
  const code = opts.code || DEFAULT_ETF_CODE;
  const name = opts.name || DEFAULT_ETF_NAME;
  const secid = opts.secid || DEFAULT_ETF_SECID;
  const days = Math.min(Math.max(opts.days ?? 90, 10), 250);
  const concurrency = deps.concurrency ?? 8;
  const klines = await deps.fetchKlines(secid, days);
  if (klines.length < 2) {
    throw new Error("ETF \u65E5\u7EBF\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u8BA1\u7B97\u51C0\u6D41\u5165");
  }
  const shareByDate = /* @__PURE__ */ new Map();
  const pendingDates = [];
  await mapPool(klines, concurrency, async (row) => {
    const cached = deps.getCachedShareWan ? await deps.getCachedShareWan(code, row.date) : void 0;
    if (typeof cached === "number" && Number.isFinite(cached)) {
      shareByDate.set(row.date, cached);
      return;
    }
    const wan = await deps.fetchShareWan(code, row.date);
    if (wan == null || !Number.isFinite(wan)) {
      pendingDates.push(row.date);
      return;
    }
    shareByDate.set(row.date, wan);
    if (deps.setCachedShareWan) await deps.setCachedShareWan(code, row.date, wan);
  });
  const series = [];
  for (let i = 0; i < klines.length; i++) {
    const { date, close } = klines[i];
    const shareWan = shareByDate.get(date);
    if (shareWan == null) continue;
    let netInflowYi = null;
    if (i > 0) {
      const prev = klines[i - 1];
      const prevShare = shareByDate.get(prev.date);
      if (prevShare != null) {
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
    pendingDates: pendingDates.sort(),
    note: "\u51C0\u6D41\u5165 \u2248 \u65E5\u4EFD\u989D\u53D8\u52A8 \xD7 \u6536\u76D8\u4EF7\uFF1B\u4EFD\u989D\u6765\u81EA\u4E0A\u4EA4\u6240\uFF0C\u5E38\u665A\u4E00\u5929\u62AB\u9732\u3002\u5355\u53EA ETF \u7533\u8D4E\u51C0\u989D\u662F\u5927\u8D44\u91D1\u4EE3\u7406\u6307\u6807\uFF0C\u975E\u5B98\u65B9\u300C\u56FD\u5BB6\u961F\u300D\u53E3\u5F84\u3002"
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
async function handleEtfFlow(request, env) {
  if (request.method !== "GET") return json({ message: "method not allowed" }, 405);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || DEFAULT_ETF_CODE;
  const days = Number(url.searchParams.get("days") || "90");
  const kv = env.INTRADAY_KV;
  try {
    const result = await buildEtfFlowSeries(
      { code, name: DEFAULT_ETF_NAME, secid: DEFAULT_ETF_SECID, days },
      {
        concurrency: 8,
        async fetchKlines(secid, limit) {
          const dest = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${limit}`;
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
        async getCachedShareWan(etfCode, date) {
          if (!kv) return void 0;
          const raw = await kv.get(`etfshare:${etfCode}:${date}`);
          if (raw == null) return void 0;
          const n = Number(raw);
          return Number.isFinite(n) ? n : void 0;
        },
        async setCachedShareWan(etfCode, date, shareWan) {
          if (!kv) return;
          await kv.put(`etfshare:${etfCode}:${date}`, String(shareWan));
        }
      }
    );
    return json(result);
  } catch (e) {
    return json({ message: e instanceof Error ? e.message : String(e) }, 502);
  }
}
__name(handleEtfFlow, "handleEtfFlow");
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
