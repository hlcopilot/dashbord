var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

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
async function handleApi(request, env) {
  const pathname = new URL(request.url).pathname;
  if (request.method === "OPTIONS") {
    return json({ ok: true });
  }
  if (pathname.startsWith("/api/local/intraday")) {
    return handleIntradayArchive(request, env);
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
