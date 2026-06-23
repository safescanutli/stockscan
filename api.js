const providerLabels = {
  yahoo: "Yahoo Finance",
  yahooRapid: "Yahoo Finance RapidAPI",
  finnhub: "Finnhub",
  twelveData: "Twelve Data",
  alphaVantage: "Alpha Vantage",
  marketstack: "Marketstack"
};

async function loadCandidates(settings) {
  if (settings.dataMode === "mock") {
    const result = loadMockCandidates(settings);
    return { ...result, source: "Mock learning examples", warning: "Mock mode is for app testing and learning examples only.", marketContext: mockMarketContext() };
  }
  const providers = providersToTry(settings);
  let lastError = null;

  for (const provider of providers) {
    try {
      const marketContext = await safeMarketContext(settings, provider);
      const scanResult = await fetchLiveCandidates(settings, provider);
      const candidates = applyMarketContext(scanResult.candidates, marketContext);
      if (candidates.length) {
        return {
          candidates,
          source: providerLabels[provider] || provider,
          warning: delayedDataWarning(provider),
          marketContext,
          scanSummary: summarizeDisplayedCandidates(scanResult.summary, candidates)
        };
      }
      lastError = new Error(`${providerLabels[provider]} returned no scan candidates.`);
    } catch (error) {
      lastError = error;
    }
  }

  return {
    candidates: [],
    source: "Live data unavailable",
    warning: lastError ? liveDataHelpMessage(lastError.message, providers) : "Live data was unavailable.",
    marketContext: null,
    scanSummary: emptyScanSummary()
  };
}

function liveDataHelpMessage(message, providers) {
  if (providers.length === 1 && providers[0] === "yahoo") {
    return `${message}. The app is using public Yahoo data in static mode. If Yahoo is blocked or rate-limited, try again later or use a browser-saved provider key in Settings.`;
  }
  return `Live data was unavailable: ${message}`;
}

async function safeMarketContext(settings, provider) {
  try {
    return await loadMarketContext(settings, provider);
  } catch {
    return null;
  }
}

function applyMarketContext(candidates, marketContext) {
  if (marketContext?.status !== "Stand aside") return candidates;
  return candidates.map((candidate) => {
    if (candidate.status !== "Approved") return candidate;
    return {
      ...candidate,
      status: "Watch",
      marketWarning: "Broad market is weak, so this is a learning watch only."
    };
  });
}

function providersToTry(settings) {
  if (settings.dataProvider && settings.dataProvider !== "auto") return [settings.dataProvider];
  if (serverProxyEnabled(settings)) return ["finnhub", "twelveData", "alphaVantage", "yahoo", "marketstack"];
  const providers = [];
  if (settings.yahooRapidApiKey) providers.push("yahooRapid");
  if (settings.finnhubKey) providers.push("finnhub");
  if (settings.twelveDataKey) providers.push("twelveData");
  if (settings.marketstackKey) providers.push("marketstack");
  if (settings.alphaVantageKey) providers.push("alphaVantage");
  providers.push("yahoo");
  return providers;
}

function delayedDataWarning(provider) {
  return "Free market data can be delayed, rate-limited, or unavailable after hours. Use it for paper-trading education only.";
}

async function fetchLiveCandidates(settings, provider) {
  const universe = await buildStockUniverse(settings, provider);
  const symbols = universe.slice(0, Math.max(1, settings.maxSymbolsPerScan || settings.maxCandidates * 4));
  const summary = emptyScanSummary();
  summary.symbolsScanned = symbols.length;
  summary.filteredByUniverse = Math.max(0, universe.length - symbols.length);
  const results = [];
  const batchSize = serverProxyEnabled(settings) ? 12 : 6;
  for (let index = 0; index < symbols.length; index += batchSize) {
    const batch = symbols.slice(index, index + batchSize);
    const settled = await Promise.allSettled(batch.map((symbol) => fetchSymbolCandles(symbol, settings, provider)));
    results.push(...settled);
  }
  const candidates = results
    .filter((result) => {
      const pass = result.status === "fulfilled" && result.value;
      if (!pass) summary.filteredByMissingData += 1;
      return pass;
    })
    .map((result) => result.value)
    .filter((candidate) => {
      const pass = candidate.price >= settings.minPrice;
      if (!pass) summary.filteredByPrice += 1;
      return pass;
    })
    .filter((candidate) => {
      const pass = candidate.volume >= settings.minVolume;
      if (!pass) summary.filteredByVolume += 1;
      return pass;
    })
    .map((candidate) => enrichCandidate(candidate, settings))
    .map(addLearningGroup)
    .map(addRejectionReasons)
    .filter((candidate) => candidate.score >= displayScoreFloor(settings) || candidate.learningGroup === "Rejected")
    .sort(candidateSort);
  summary.candidatesFound = candidates.length;
  summary.scoredCandidates = candidates.length;
  Object.assign(summary, groupCounts(candidates));
  summary.topRejectionReasons = topRejectionReasons(candidates);
  return {
    candidates: selectDisplayCandidates(candidates, settings),
    summary
  };
}

async function buildStockUniverse(settings, provider) {
  const cached = loadCachedUniverse(settings);
  if (cached.length) return cached;
  let symbols = settings.scanMode === "full"
    ? parseSymbols([...(fastBeginnerUniverse || []), settings.watchlist].join(","))
    : parseSymbols([...(fastBeginnerUniverse || []), settings.watchlist].join(","));
  symbols = filterUniverseSymbols(symbols, settings);
  saveCachedUniverse(settings, symbols);
  return symbols;
}

function filterUniverseSymbols(symbols, settings) {
  const blockedFragments = ["W", "WS", "WT", "U", "PRA", "PRB", "3X", "2X", "BEAR", "BULL", "ULTRA", "SHORT", "INVERSE"];
  return [...new Set(symbols)]
    .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,7}$/.test(symbol))
    .filter((symbol) => settings.includeEtfs || !["SPY", "QQQ", "IWM", "DIA"].includes(symbol))
    .filter((symbol) => !settings.excludeLeveragedEtfs || !blockedFragments.some((fragment) => symbol.includes(fragment) && symbol.length > 3));
}

function loadCachedUniverse(settings) {
  try {
    const cached = JSON.parse(localStorage.getItem(`ptp-universe-${settings.scanMode || "fast"}`) || "null");
    if (!cached || Date.now() - cached.createdAt > 24 * 60 * 60 * 1000) return [];
    return cached.symbols || [];
  } catch {
    return [];
  }
}

function saveCachedUniverse(settings, symbols) {
  try {
    localStorage.setItem(`ptp-universe-${settings.scanMode || "fast"}`, JSON.stringify({ createdAt: Date.now(), symbols }));
  } catch {}
}

function emptyScanSummary() {
  return { symbolsScanned: 0, filteredByUniverse: 0, filteredByPrice: 0, filteredByVolume: 0, filteredByMissingData: 0, filteredByLiquidity: 0, candidatesFound: 0, scoredCandidates: 0, approved: 0, watch: 0, study: 0, learning: 0, needsWork: 0, rejected: 0, errors: 0, topRejectionReasons: [] };
}

function loadMockCandidates(settings) {
  const candidates = mockUniverse
    .map((item) => candidateFromCandles(item.symbol, item.candles, "mock"))
    .map((candidate, index) => {
      if (mockUniverse[index]?.label.includes("Invalidated")) candidate.support = candidate.price * 1.05;
      if (mockUniverse[index]?.label.includes("poor account")) candidate.stop = candidate.entry * 0.86;
      if (mockUniverse[index]?.label.includes("Gap too large")) candidate.price = candidate.entry * 1.045;
      if (mockUniverse[index]?.label.includes("Unrealistic")) candidate.resistance = candidate.entry * 1.06;
      return enrichCandidate(candidate, settings);
    })
    .map(addLearningGroup)
    .map(addRejectionReasons)
    .sort(candidateSort);
  const displayed = selectDisplayCandidates(candidates, settings);
  return {
    candidates: displayed,
    scanSummary: summarizeDisplayedCandidates({ ...emptyScanSummary(), symbolsScanned: mockUniverse.length, candidatesFound: candidates.length, scoredCandidates: candidates.length, ...groupCounts(candidates), topRejectionReasons: topRejectionReasons(candidates) }, displayed)
  };
}

function mockMarketContext() {
  return { status: "Caution", indexes: [{ symbol: "SPY", bias: "Mixed", changePercent: 0 }, { symbol: "QQQ", bias: "Mixed", changePercent: 0 }], lesson: "Mock market context is for testing the workflow only." };
}

function addLearningGroup(candidate) {
  const learningGroup = learningGroupForCandidate(candidate);
  return {
    ...candidate,
    learningGroup,
    displayLabel: displayLabelForGroup(learningGroup),
    learningGroupShort: learningGroup.replace(" / ", " "),
    displayStatus: learningGroup
  };
}

function learningGroupForCandidate(candidate) {
  if (candidate.status === "Approved") return "Approved Trade Plan";
  if (candidate.score >= 65) return "Watchlist Setup";
  if (candidate.score >= 50) return "Learning Candidate";
  return "Rejected";
}

function displayLabelForGroup(group) {
  if (group === "Approved Trade Plan") return "Approved";
  if (group === "Watchlist Setup") return "Watch";
  if (group === "Learning Candidate") return "Study";
  return "Skip";
}

function candidateSort(a, b) {
  return learningRank(a.learningGroup) - learningRank(b.learningGroup) || b.score - a.score;
}

function learningRank(group) {
  if (group === "Approved Trade Plan") return 0;
  if (group === "Watchlist Setup") return 1;
  if (group === "Learning Candidate") return 2;
  return 3;
}

function selectDisplayCandidates(candidates, settings) {
  const maxCandidates = Math.min(25, Math.max(1, Number(settings.maxCandidates || 25)));
  const approved = candidates.filter((item) => item.learningGroup === "Approved Trade Plan");
  const watch = candidates.filter((item) => item.learningGroup === "Watchlist Setup");
  const study = candidates.filter((item) => item.learningGroup === "Learning Candidate");
  const rejected = candidates.filter((item) => item.learningGroup === "Rejected");
  const selected = [];

  if (!settings.learningMode || settings.beginnerStrictMode) {
    pushUnique(selected, approved.slice(0, Math.min(5, maxCandidates)));
    pushUnique(selected, watch.slice(0, maxCandidates - selected.length));
    pushUnique(selected, study.filter((item) => item.score >= 60).slice(0, Math.min(5, maxCandidates - selected.length)));
    if (settings.showRejectedCandidates) pushUnique(selected, rejected.slice(0, Math.min(3, maxCandidates - selected.length)));
    return selected.slice(0, maxCandidates).sort(candidateSort);
  }

  pushUnique(selected, approved.slice(0, Math.min(5, maxCandidates)));
  pushUnique(selected, watch.slice(0, Math.min(10, maxCandidates - selected.length)));
  pushUnique(selected, study.slice(0, Math.min(10, maxCandidates - selected.length)));
  pushUnique(selected, watch.slice(selected.filter((item) => item.learningGroup === "Watchlist Setup").length, selected.filter((item) => item.learningGroup === "Watchlist Setup").length + Math.max(0, maxCandidates - selected.length)));
  pushUnique(selected, study.slice(selected.filter((item) => item.learningGroup === "Learning Candidate").length, selected.filter((item) => item.learningGroup === "Learning Candidate").length + Math.max(0, maxCandidates - selected.length)));
  if (settings.showRejectedCandidates || !selected.length) pushUnique(selected, rejected.slice(0, maxCandidates - selected.length));
  return selected.slice(0, maxCandidates).sort(candidateSort);
}

function pushUnique(target, items) {
  items.forEach((item) => {
    if (!target.some((existing) => existing.ticker === item.ticker)) target.push(item);
  });
}

function groupCounts(candidates) {
  return {
    approved: candidates.filter((item) => item.learningGroup === "Approved Trade Plan").length,
    watch: candidates.filter((item) => item.learningGroup === "Watchlist Setup").length,
    study: candidates.filter((item) => item.learningGroup === "Learning Candidate").length,
    learning: candidates.filter((item) => item.learningGroup === "Learning Candidate").length,
    needsWork: candidates.filter((item) => item.learningGroup === "Learning Candidate").length,
    rejected: candidates.filter((item) => item.learningGroup === "Rejected").length
  };
}

function summarizeDisplayedCandidates(summary, displayed) {
  return {
    ...summary,
    displayed: displayed.length,
    displayedApproved: displayed.filter((item) => item.learningGroup === "Approved Trade Plan").length,
    displayedWatch: displayed.filter((item) => item.learningGroup === "Watchlist Setup").length,
    displayedStudy: displayed.filter((item) => item.learningGroup === "Learning Candidate").length,
    displayedLearning: displayed.filter((item) => item.learningGroup === "Learning Candidate").length,
    displayedNeedsWork: displayed.filter((item) => item.learningGroup === "Learning Candidate").length,
    displayedRejected: displayed.filter((item) => item.learningGroup === "Rejected").length
  };
}

function displayScoreFloor(settings) {
  return settings.learningMode ? 45 : 65;
}

function addRejectionReasons(candidate) {
  return {
    ...candidate,
    rejectionReasons: rejectionReasons(candidate)
  };
}

function rejectionReasons(candidate) {
  const reasons = [];
  if (candidate.stopValidation?.status === "Too Wide" || candidate.stopValidation?.status === "Wide") reasons.push("Stop too wide");
  if (candidate.targetValidation?.standard.status === "Unrealistic" || candidate.targetValidation?.standard.status === "Low Probability") reasons.push("Target unrealistic");
  if (candidate.accountFit?.status === "Poor Fit" || candidate.accountFit?.status === "Does Not Fit") reasons.push("Poor account fit");
  if (candidate.volume < candidate.averageVolume || !candidate.dayTradeChecks?.liquidityFit) reasons.push("Weak volume");
  if (!candidate.resistance || candidate.entry <= candidate.price) reasons.push("No clean resistance");
  if (candidate.entry > candidate.price * 1.04) reasons.push("Not near breakout");
  if (candidate.scores?.trendStrength < 12 || candidate.scores?.existingUptrend < 12) reasons.push("Trend too weak");
  if (!reasons.length && candidate.status !== "Approved") reasons.push("Needs confirmation");
  return reasons;
}

function topRejectionReasons(candidates) {
  const counts = {};
  candidates.forEach((candidate) => {
    (candidate.rejectionReasons || rejectionReasons(candidate)).forEach((reason) => {
      counts[reason] = (counts[reason] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([reason, count]) => ({ reason, count }));
}

async function loadMarketContext(settings, provider) {
  const symbols = parseSymbols(settings.marketBiasSymbols || "SPY, QQQ").slice(0, 3);
  const results = await Promise.allSettled(symbols.map((symbol) => fetchSymbolCandles(symbol, settings, provider)));
  const indexes = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value)
    .map((candidate) => analyzeMarketSymbol(candidate));
  const bullishCount = indexes.filter((item) => item.bias === "Bullish").length;
  const weakCount = indexes.filter((item) => item.bias === "Weak").length;
  const status = !indexes.length ? "Unknown" : weakCount >= Math.ceil(indexes.length / 2) ? "Stand aside" : bullishCount >= Math.ceil(indexes.length / 2) ? "Trade allowed" : "Caution";
  const lesson = status === "Trade allowed"
    ? "Long day-trade setups have a better learning environment when SPY/QQQ are holding above short-term trend."
    : status === "Caution"
      ? "Market direction is mixed, so reduce expectations and be quicker to skip weak triggers."
      : status === "Stand aside"
        ? "The broad market is weak. For a beginner, protecting capital and observing may be the best trade."
        : "Market context could not be loaded from the provider.";
  return { status, indexes, lesson };
}

function analyzeMarketSymbol(candidate) {
  const candles = candidate.candles.slice(-20);
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2] || last;
  const ma10 = average(candles.slice(-10).map((candle) => candle[3]));
  const close = last[3];
  const changePercent = previous[3] ? ((close - previous[3]) / previous[3]) * 100 : 0;
  const bias = close > ma10 && changePercent >= -0.35 ? "Bullish" : close < ma10 && changePercent < 0 ? "Weak" : "Mixed";
  return {
    symbol: candidate.ticker,
    price: candidate.price,
    changePercent,
    bias
  };
}

function parseSymbols(value) {
  return [...new Set(String(value || "").toUpperCase().split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))]
    .filter((symbol) => /^[A-Z0-9.-]{1,8}$/.test(symbol));
}

async function fetchSymbolCandles(symbol, settings, provider) {
  if (serverProxyEnabled(settings)) return candidateFromCandles(symbol, await fetchServerCandles(symbol, provider), provider);
  if (provider === "yahooRapid") return candidateFromCandles(symbol, await fetchYahooRapidCandles(symbol, settings), provider);
  if (provider === "finnhub") return candidateFromCandles(symbol, await fetchFinnhubCandles(symbol, settings), provider);
  if (provider === "twelveData") return candidateFromCandles(symbol, await fetchTwelveDataCandles(symbol, settings), provider);
  if (provider === "marketstack") return candidateFromCandles(symbol, await fetchMarketstackCandles(symbol, settings), provider);
  if (provider === "alphaVantage") return candidateFromCandles(symbol, await fetchAlphaVantageCandles(symbol, settings), provider);
  return candidateFromCandles(symbol, await fetchYahooCandles(symbol), provider);
}

function serverProxyEnabled(settings = defaultSettings) {
  return Boolean(settings.useServerProxy) && location.protocol !== "file:";
}

async function fetchServerCandles(symbol, provider) {
  const data = await fetchJson(`/api/candles?provider=${encodeURIComponent(provider)}&symbol=${encodeURIComponent(symbol)}`);
  if (data.error) throw new Error(data.error);
  if (!data.candles?.length) throw new Error(`${providerLabels[provider] || provider} returned no candles.`);
  return data.candles;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchYahooCandles(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d&includePrePost=false`;
  const data = await fetchJson(url);
  const result = data.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) throw new Error("Yahoo chart data was missing.");
  return normalizeYahooArrays(quote.open, quote.high, quote.low, quote.close, quote.volume);
}

async function fetchYahooRapidCandles(symbol, settings) {
  const host = settings.yahooRapidApiHost || defaultSettings.yahooRapidApiHost;
  const url = `https://${host}/stock/v3/get-chart?symbol=${encodeURIComponent(symbol)}&region=US&interval=1d&range=3mo`;
  const data = await fetchJson(url, {
    headers: {
      "X-RapidAPI-Key": settings.yahooRapidApiKey,
      "X-RapidAPI-Host": host
    }
  });
  const result = data.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) throw new Error("Yahoo RapidAPI chart data was missing.");
  return normalizeYahooArrays(quote.open, quote.high, quote.low, quote.close, quote.volume);
}

async function fetchFinnhubCandles(symbol, settings) {
  if (!settings.finnhubKey) throw new Error("Finnhub key is not set.");
  const to = Math.floor(Date.now() / 1000);
  const from = to - 90 * 24 * 60 * 60;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${encodeURIComponent(settings.finnhubKey)}`;
  const data = await fetchJson(url);
  if (data.s !== "ok") throw new Error("Finnhub candle data was unavailable.");
  return normalizeYahooArrays(data.o, data.h, data.l, data.c, data.v);
}

async function fetchTwelveDataCandles(symbol, settings) {
  if (!settings.twelveDataKey) throw new Error("Twelve Data key is not set.");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=90&apikey=${encodeURIComponent(settings.twelveDataKey)}`;
  const data = await fetchJson(url);
  if (data.status === "error" || !data.values) throw new Error(data.message || "Twelve Data candles were unavailable.");
  return data.values
    .slice()
    .reverse()
    .map((row) => [Number(row.open), Number(row.high), Number(row.low), Number(row.close), Number(row.volume || 0)])
    .filter(validCandle);
}

async function fetchAlphaVantageCandles(symbol, settings) {
  if (!settings.alphaVantageKey) throw new Error("Alpha Vantage key is not set.");
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(settings.alphaVantageKey)}`;
  const data = await fetchJson(url);
  const series = data["Time Series (Daily)"];
  if (!series) throw new Error(data.Note || data.Information || "Alpha Vantage candles were unavailable.");
  return Object.entries(series)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => [Number(row["1. open"]), Number(row["2. high"]), Number(row["3. low"]), Number(row["4. close"]), Number(row["6. volume"] || row["5. volume"] || 0)])
    .filter(validCandle);
}

async function fetchMarketstackCandles(symbol, settings) {
  if (!settings.marketstackKey) throw new Error("Marketstack key is not set.");
  const baseUrl = settings.marketstackBaseUrl || defaultSettings.marketstackBaseUrl;
  const url = `${baseUrl}/eod?access_key=${encodeURIComponent(settings.marketstackKey)}&symbols=${encodeURIComponent(symbol)}&limit=90`;
  const data = await fetchJson(url);
  if (data.error) throw new Error(data.error.message || "Marketstack candles were unavailable.");
  if (!data.data?.length) throw new Error("Marketstack returned no candles.");
  return data.data
    .slice()
    .reverse()
    .map((row) => [Number(row.open), Number(row.high), Number(row.low), Number(row.close), Number(row.volume || 0)])
    .filter(validCandle);
}

function normalizeYahooArrays(open = [], high = [], low = [], close = [], volume = []) {
  return close
    .map((_, index) => [Number(open[index]), Number(high[index]), Number(low[index]), Number(close[index]), Number(volume[index] || 0)])
    .filter(validCandle);
}

function validCandle(candle) {
  return candle.every((value, index) => index === 4 ? Number.isFinite(value) : Number.isFinite(value) && value > 0);
}

function candidateFromCandles(symbol, candles, provider) {
  if (!candles || candles.length < 25) throw new Error(`${symbol} did not have enough daily candles.`);
  const recent = candles.slice(-30);
  const visibleCandles = candles.slice(-45);
  const last = recent[recent.length - 1];
  const previous = recent.slice(0, -1);
  const prior = previous[previous.length - 1] || last;
  const price = roundPrice(last[3]);
  const volume = Math.round(last[4]);
  const averageVolume = Math.round(average(previous.map((candle) => candle[4])));
  const support = roundPrice(Math.min(...recent.slice(-12).map((candle) => candle[2])));
  const resistance = roundPrice(Math.max(...previous.slice(-15).map((candle) => candle[1])));
  const ma10 = average(recent.slice(-10).map((candle) => candle[3]));
  const ma20 = average(recent.slice(-20).map((candle) => candle[3]));
  const highLowRange = Math.max(0.01, last[1] - last[2]);
  const closeLocation = (last[3] - last[2]) / highLowRange;
  const volumeRatio = averageVolume ? volume / averageVolume : 1;
  const nearResistance = price >= resistance * 0.97;
  const controlledPullback = recent.slice(-5, -1).some((candle) => candle[3] < candle[0]) && price > ma10 * 0.98;
  const setupType = nearResistance && closeLocation > 0.55 ? "Momentum Breakout" : "Pullback Breakout";
  const entry = roundPrice(Math.max(resistance * 1.005, price * 1.004));
  const stopBase = setupType === "Momentum Breakout" ? Math.max(support, ma20 * 0.985) : Math.max(support * 0.995, ma20 * 0.97);
  const stop = roundPrice(Math.min(entry * 0.985, stopBase));
  const risk = Math.max(0.03, entry - stop);
  const target1 = roundPrice(entry + risk * 2);
  const target2 = roundPrice(entry + risk * 3);
  const latestGapPercent = prior[3] ? ((last[0] - prior[3]) / prior[3]) * 100 : 0;
  const dollarVolume = Math.round(price * volume);
  const dailyRangePercent = price ? ((last[1] - last[2]) / price) * 100 : 0;
  const extended = price > ma20 * 1.14 || (support > 0 && (price - support) / support > 0.18);
  const liquidityOk = volume >= 250000 && price * volume >= 500000;

  return {
    ticker: symbol,
    price,
    setupType,
    volume,
    averageVolume,
    dollarVolume,
    latestGapPercent,
    dailyRangePercent,
    support,
    resistance,
    entry,
    stop,
    target1,
    target2,
    extended,
    liquidityOk,
    provider,
    candles: visibleCandles,
    scores: setupType === "Momentum Breakout"
      ? momentumScores({ price, resistance, ma10, ma20, closeLocation, volumeRatio, target1, entry, stop })
      : pullbackScores({ price, support, ma10, ma20, closeLocation, controlledPullback, volumeRatio, target1, entry, stop })
  };
}

function momentumScores(values) {
  return {
    trendStrength: clampScore(values.price > values.ma20 ? 16 + percentScore((values.price - values.ma20) / values.ma20, 0.08, 4) : 8),
    volumeAboveAverage: clampScore(8 + values.volumeRatio * 8),
    closeNearHigh: clampScore(values.closeLocation * 20),
    resistanceQuality: clampScore(values.price >= values.resistance ? 20 : 20 - ((values.resistance - values.price) / values.resistance) * 120),
    riskRewardQuality: rrScore(values.target1, values.entry, values.stop)
  };
}

function pullbackScores(values) {
  return {
    existingUptrend: clampScore(values.price > values.ma20 && values.ma10 >= values.ma20 ? 18 : 11),
    controlledPullback: clampScore(values.controlledPullback ? 18 : 11),
    supportHolding: clampScore(values.price > values.support ? 16 + percentScore((values.price - values.support) / values.support, 0.08, 4) : 8),
    buyersReturning: clampScore(10 + values.closeLocation * 6 + Math.min(values.volumeRatio, 1.5) * 3),
    riskRewardQuality: rrScore(values.target1, values.entry, values.stop)
  };
}

function rrScore(target, entry, stop) {
  const risk = entry - stop;
  if (risk <= 0) return 0;
  return clampScore(((target - entry) / risk) * 10);
}

function percentScore(value, maxValue, points) {
  return Math.min(points, Math.max(0, value / maxValue * points));
}

function clampScore(value) {
  return Math.max(0, Math.min(20, Math.round(value)));
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.reduce((sum, value) => sum + value, 0) / Math.max(1, usable.length);
}

function roundPrice(value) {
  return Math.round(value * 100) / 100;
}
