const defaultSettings = {
  accountSize: 100,
  startingBalance: 100,
  riskPercent: 3,
  minPrice: 2,
  maxPrice: 35,
  minVolume: 100000,
  minDollarVolume: 5000000,
  minSetupScore: 45,
  maxCandidates: 25,
  maxGapPercent: 3,
  maxRiskPercentOfEntry: 8,
  scanMode: "fast",
  exchanges: ["NYSE", "NASDAQ", "AMEX"],
  includeEtfs: true,
  excludeLeveragedEtfs: true,
  excludeInverseEtfs: true,
  maxSymbolsPerScan: 250,
  beginnerStrictMode: false,
  showRejectedCandidates: false,
  marketBiasSymbols: "SPY, QQQ",
  learningMode: true,
  dataMode: "live",
  dataProvider: "auto",
  useServerProxy: false,
  watchlist: "AAPL, MSFT, NVDA, AMD, SOFI, HOOD, PLTR, RIVN, IONQ, ASTS, MARA, RIOT, DKNG, SNAP, UBER, LYFT, F, GM, T, INTC, BAC, WBD, NIO, LCID, OPEN, PINS, AFRM, UPST, COIN, NET",
  finnhubKey: "",
  twelveDataKey: "",
  alphaVantageKey: "",
  marketstackKey: "",
  yahooRapidApiKey: "",
  yahooRapidApiHost: "apidojo-yahoo-finance-v1.p.rapidapi.com",
  marketstackBaseUrl: "http://api.marketstack.com/v1",
  ...(globalThis.paperTradeApiConfig || {})
};

const fastBeginnerUniverse = [
  "AAPL", "MSFT", "NVDA", "AMD", "SOFI", "HOOD", "PLTR", "RIVN", "IONQ", "ASTS",
  "MARA", "RIOT", "DKNG", "SNAP", "UBER", "LYFT", "F", "GM", "T", "INTC",
  "BAC", "WBD", "NIO", "LCID", "OPEN", "PINS", "AFRM", "UPST", "COIN", "NET",
  "BBAI", "AI", "SOUN", "CHPT", "RUN", "QS", "PATH", "U", "DNA", "JOBY",
  "ACHR", "RKLB", "CLSK", "HIMS", "ROKU", "CCL", "AAL", "VALE", "NOK", "PFE"
];

function mockCandles(start, pattern = "approved") {
  const candles = [];
  let price = start;
  for (let index = 0; index < 45; index += 1) {
    const drift = pattern === "invalidated" && index > 34 ? -0.32 : pattern === "gap" && index === 44 ? 1.2 : 0.08;
    const open = price;
    const close = Math.max(1, open + drift + Math.sin(index / 2) * 0.12);
    const high = Math.max(open, close) + 0.28 + (index % 7 === 0 ? 0.42 : 0);
    const low = Math.min(open, close) - 0.24 - (index % 11 === 0 ? 0.22 : 0);
    const volume = 750000 + index * 18000 + (index % 6) * 90000;
    candles.push([roundTo(open), roundTo(high), roundTo(low), roundTo(close), volume]);
    price = close;
  }
  return candles;
}

function roundTo(value) {
  return Math.round(value * 100) / 100;
}

const mockUniverse = [
  { symbol: "GOOD", label: "Approved setup", candles: mockCandles(8.4, "approved") },
  { symbol: "WAIT", label: "Waiting setup", candles: mockCandles(12.2, "waiting") },
  { symbol: "REJT", label: "Rejected setup", candles: mockCandles(24.4, "rejected") },
  { symbol: "FAIL", label: "Invalidated setup", candles: mockCandles(17.8, "invalidated") },
  { symbol: "GAPP", label: "Gap too large setup", candles: mockCandles(15.1, "gap") },
  { symbol: "WIDE", label: "Good chart but poor account fit", candles: mockCandles(29.2, "wide") },
  { symbol: "ROOM", label: "Realistic target setup", candles: mockCandles(6.8, "approved") },
  { symbol: "WALL", label: "Unrealistic target setup", candles: mockCandles(20.5, "rejected") }
];
