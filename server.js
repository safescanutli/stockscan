const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const rootDir = __dirname;
const port = Number(process.env.PORT || 4173);
const localConfig = loadLocalConfig();
const appPassword = getKey("appPassword");
const authCookieName = "ptp_auth";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const blockedStaticNames = new Set([
  ".env",
  ".env.example",
  ".gitignore",
  "config.local.js",
  "Dockerfile",
  "package.json",
  "package-lock.json",
  "render.yaml",
  "server.js",
  "server.log"
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/health") return sendJson(response, { ok: true, locked: Boolean(appPassword) });
    if (url.pathname === "/login") return await handleLogin(request, response);
    if (url.pathname === "/logout") return handleLogout(response);
    if (appPassword && !isAuthenticated(request)) return requireAuth(url, response);
    if (url.pathname === "/api/providers") return sendJson(response, availableProviders());
    if (url.pathname === "/api/candles") return await handleCandles(url, response);
    return serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, { error: error.message || "Server error" }, 500);
  }
});

server.listen(port, "0.0.0.0", () => {
  writeServerLog(`Paper Trade Planner running at http://localhost:${port}`);
  writeServerLog(`Phone on same Wi-Fi: use http://YOUR-COMPUTER-IP:${port}`);
});

process.on("unhandledRejection", (error) => {
  writeServerLog(`Unhandled provider error: ${error?.message || error}`);
});

process.on("uncaughtException", (error) => {
  writeServerLog(`Server error: ${error?.message || error}`);
});

function serveStatic(urlPath, response) {
  const cleanPath = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const filePath = path.resolve(rootDir, `.${cleanPath}`);
  if (!filePath.startsWith(rootDir)) return sendText(response, "Not found", 404);
  if (isBlockedStaticFile(filePath)) return sendText(response, "Not found", 404);
  fs.readFile(filePath, (error, content) => {
    if (error) return sendText(response, "Not found", 404);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

function isBlockedStaticFile(filePath) {
  const relativePath = path.relative(rootDir, filePath);
  const firstPart = relativePath.split(path.sep)[0];
  const fileName = path.basename(filePath);
  return (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    firstPart === ".git" ||
    firstPart === "node_modules" ||
    blockedStaticNames.has(fileName) ||
    fileName.endsWith(".log")
  );
}

async function handleLogin(request, response) {
  if (!appPassword) return redirect(response, "/");
  if (request.method === "GET") return sendLoginPage(response);
  if (request.method !== "POST") return sendText(response, "Method not allowed", 405);

  const body = await readBody(request);
  const params = new URLSearchParams(body);
  const password = String(params.get("password") || "");
  if (password !== appPassword) return sendLoginPage(response, "That password did not match.");

  response.writeHead(302, {
    "Location": "/",
    "Set-Cookie": `${authCookieName}=${authToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`,
    "Cache-Control": "no-store"
  });
  response.end();
}

function handleLogout(response) {
  response.writeHead(302, {
    "Location": "/login",
    "Set-Cookie": `${authCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    "Cache-Control": "no-store"
  });
  response.end();
}

function requireAuth(url, response) {
  if (url.pathname.startsWith("/api/")) {
    return sendJson(response, { error: "Password required." }, 401);
  }
  return sendLoginPage(response);
}

function isAuthenticated(request) {
  if (!appPassword) return true;
  const cookies = parseCookies(request.headers.cookie || "");
  return cookies[authCookieName] === authToken();
}

function authToken() {
  return crypto.createHash("sha256").update(`paper-trade-planner:${appPassword}`).digest("hex");
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((cookies, item) => {
    const [name, ...valueParts] = item.trim().split("=");
    if (!name) return cookies;
    cookies[name] = decodeURIComponent(valueParts.join("=") || "");
    return cookies;
  }, {});
}

function readBody(request, limit = 10000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function handleCandles(url, response) {
  const provider = String(url.searchParams.get("provider") || "yahoo");
  const symbol = cleanSymbol(url.searchParams.get("symbol"));
  if (!symbol) return sendJson(response, { error: "Missing or invalid symbol." }, 400);

  const candles = await fetchProviderCandles(provider, symbol);
  sendJson(response, { provider, symbol, candles });
}

function cleanSymbol(value) {
  const symbol = String(value || "").toUpperCase().trim();
  return /^[A-Z0-9.-]{1,12}$/.test(symbol) ? symbol : "";
}

async function fetchProviderCandles(provider, symbol) {
  if (provider === "finnhub") return fetchFinnhubCandles(symbol);
  if (provider === "twelveData") return fetchTwelveDataCandles(symbol);
  if (provider === "marketstack") return fetchMarketstackCandles(symbol);
  if (provider === "alphaVantage") return fetchAlphaVantageCandles(symbol);
  if (provider === "yahooRapid") return fetchYahooRapidCandles(symbol);
  return fetchYahooCandles(symbol);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchYahooCandles(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d&includePrePost=false`;
  const data = await fetchJson(url);
  const quote = data.chart?.result?.[0]?.indicators?.quote?.[0];
  if (!quote) throw new Error("Yahoo chart data was missing.");
  return normalizeArrays(quote.open, quote.high, quote.low, quote.close, quote.volume);
}

async function fetchYahooRapidCandles(symbol) {
  const key = getKey("yahooRapidApiKey");
  const host = getKey("yahooRapidApiHost") || "apidojo-yahoo-finance-v1.p.rapidapi.com";
  if (!key) throw new Error("Yahoo RapidAPI key is not configured on the server.");
  const url = `https://${host}/stock/v3/get-chart?symbol=${encodeURIComponent(symbol)}&region=US&interval=1d&range=3mo`;
  const data = await fetchJson(url, {
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": host
    }
  });
  const quote = data.chart?.result?.[0]?.indicators?.quote?.[0];
  if (!quote) throw new Error("Yahoo RapidAPI chart data was missing.");
  return normalizeArrays(quote.open, quote.high, quote.low, quote.close, quote.volume);
}

async function fetchFinnhubCandles(symbol) {
  const key = getKey("finnhubKey");
  if (!key) throw new Error("Finnhub key is not configured on the server.");
  const to = Math.floor(Date.now() / 1000);
  const from = to - 90 * 24 * 60 * 60;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
  const data = await fetchJson(url);
  if (data.s !== "ok") throw new Error("Finnhub candle data was unavailable.");
  return normalizeArrays(data.o, data.h, data.l, data.c, data.v);
}

async function fetchTwelveDataCandles(symbol) {
  const key = getKey("twelveDataKey");
  if (!key) throw new Error("Twelve Data key is not configured on the server.");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=90&apikey=${encodeURIComponent(key)}`;
  const data = await fetchJson(url);
  if (data.status === "error" || !data.values) throw new Error(data.message || "Twelve Data candles were unavailable.");
  return data.values
    .slice()
    .reverse()
    .map((row) => [Number(row.open), Number(row.high), Number(row.low), Number(row.close), Number(row.volume || 0)])
    .filter(validCandle);
}

async function fetchAlphaVantageCandles(symbol) {
  const key = getKey("alphaVantageKey");
  if (!key) throw new Error("Alpha Vantage key is not configured on the server.");
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(key)}`;
  const data = await fetchJson(url);
  const series = data["Time Series (Daily)"];
  if (!series) throw new Error(data.Note || data.Information || "Alpha Vantage candles were unavailable.");
  return Object.entries(series)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => [Number(row["1. open"]), Number(row["2. high"]), Number(row["3. low"]), Number(row["4. close"]), Number(row["6. volume"] || row["5. volume"] || 0)])
    .filter(validCandle);
}

async function fetchMarketstackCandles(symbol) {
  const key = getKey("marketstackKey");
  if (!key) throw new Error("Marketstack key is not configured on the server.");
  const baseUrl = getKey("marketstackBaseUrl") || "http://api.marketstack.com/v1";
  const url = `${baseUrl}/eod?access_key=${encodeURIComponent(key)}&symbols=${encodeURIComponent(symbol)}&limit=90`;
  const data = await fetchJson(url);
  if (data.error) throw new Error(data.error.message || "Marketstack candles were unavailable.");
  if (!data.data?.length) throw new Error("Marketstack returned no candles.");
  return data.data
    .slice()
    .reverse()
    .map((row) => [Number(row.open), Number(row.high), Number(row.low), Number(row.close), Number(row.volume || 0)])
    .filter(validCandle);
}

function normalizeArrays(open = [], high = [], low = [], close = [], volume = []) {
  return close
    .map((_, index) => [Number(open[index]), Number(high[index]), Number(low[index]), Number(close[index]), Number(volume[index] || 0)])
    .filter(validCandle);
}

function validCandle(candle) {
  return candle.every((value, index) => index === 4 ? Number.isFinite(value) : Number.isFinite(value) && value > 0);
}

function availableProviders() {
  return {
    yahoo: true,
    yahooRapid: Boolean(getKey("yahooRapidApiKey")),
    finnhub: Boolean(getKey("finnhubKey")),
    twelveData: Boolean(getKey("twelveDataKey")),
    marketstack: Boolean(getKey("marketstackKey")),
    alphaVantage: Boolean(getKey("alphaVantageKey"))
  };
}

function getKey(name) {
  const envName = name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
  return process.env[envName] || localConfig[name] || "";
}

function loadLocalConfig() {
  const configPath = path.join(rootDir, "config.local.js");
  if (!fs.existsSync(configPath)) return {};
  const sandbox = { globalThis: {} };
  try {
    vm.runInNewContext(fs.readFileSync(configPath, "utf8"), sandbox, { filename: configPath, timeout: 1000 });
    return sandbox.globalThis.paperTradeApiConfig || {};
  } catch {
    return {};
  }
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function sendLoginPage(response, error = "") {
  response.writeHead(error ? 401 : 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Paper Trade Planner</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f7fb; color: #172033; }
    main { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; box-shadow: 0 18px 45px rgba(23, 32, 51, .12); }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.1; }
    p { margin: 0 0 20px; color: #526173; line-height: 1.5; }
    label { display: block; font-weight: 700; margin-bottom: 8px; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #c8d3e1; border-radius: 7px; padding: 13px 14px; font-size: 16px; }
    button { width: 100%; margin-top: 14px; border: 0; border-radius: 7px; padding: 13px 14px; font-size: 16px; font-weight: 800; color: #fff; background: #1766d1; cursor: pointer; }
    .error { color: #b42318; font-weight: 700; margin-bottom: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>Paper Trade Planner</h1>
    <p>Enter your private app password to continue.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/login">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
      <button type="submit">Open app</button>
    </form>
  </main>
</body>
</html>`);
}

function redirect(response, location) {
  response.writeHead(302, { "Location": location, "Cache-Control": "no-store" });
  response.end();
}

function sendText(response, text, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function writeServerLog(message) {
  try {
    fs.appendFileSync(path.join(rootDir, "server.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never keep the server from starting.
  }
}
