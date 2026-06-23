const storageKeys = {
  settings: "ptp-settings",
  plans: "ptp-plans",
  journal: "ptp-journal",
  accountEntries: "ptp-account-entries",
  unlocked: "ptp-unlocked"
};

const pageTitles = {
  dashboard: "Dashboard",
  candidates: "Candidate List",
  detail: "Setup Detail",
  plans: "Trade Plans",
  journal: "Paper Trade Journal",
  progress: "Account Progress",
  stats: "Stats",
  settings: "Settings"
};

let state = {
  settings: mergeSettings(loadJson(storageKeys.settings, {})),
  candidates: [],
  selectedTicker: null,
  plans: loadJson(storageKeys.plans, []),
  journal: loadJson(storageKeys.journal, []),
  accountEntries: loadJson(storageKeys.accountEntries, []),
  dataStatus: {
    source: "Not scanned yet",
    warning: null,
    lastScan: null,
    marketContext: null,
    scanSummary: null,
    serverStatus: null
  },
  chart: {
    candlesVisible: 12,
    showLabels: false
  },
  scanning: false
};

async function initializeApp() {
  if (await passwordGateRequired()) {
    showPasswordScreen();
    return;
  }
  unlockApp();
}

async function passwordGateRequired() {
  const hash = appPasswordHash();
  if (!hash) return false;
  return sessionStorage.getItem(storageKeys.unlocked) !== hash;
}

function appPasswordHash() {
  return String(window.paperTradeSiteConfig?.passwordHash || "").trim();
}

function showPasswordScreen() {
  const screen = document.querySelector("#passwordScreen");
  const form = document.querySelector("#passwordForm");
  if (!screen || !form) return unlockApp();
  document.body.classList.add("locked");
  screen.hidden = false;
  form.addEventListener("submit", handlePasswordSubmit);
}

async function handlePasswordSubmit(event) {
  event.preventDefault();
  const password = document.querySelector("#appPassword")?.value || "";
  const enteredHash = await sha256(password);
  if (enteredHash === appPasswordHash()) {
    sessionStorage.setItem(storageKeys.unlocked, enteredHash);
    document.querySelector("#passwordScreen").hidden = true;
    document.body.classList.remove("locked");
    unlockApp();
    return;
  }
  const error = document.querySelector("#passwordError");
  if (error) error.textContent = "That password did not match.";
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unlockApp() {
  document.body.classList.remove("locked");
  render();
  runScan();
}

function mergeSettings(savedSettings) {
  const merged = { ...defaultSettings, ...savedSettings };
  merged.dataMode = "live";
  if (!Number.isFinite(Number(merged.accountSize)) || Number(merged.accountSize) <= 0) merged.accountSize = 100;
  if (!Number.isFinite(Number(merged.startingBalance)) || Number(merged.startingBalance) <= 0) merged.startingBalance = 100;
  merged.useServerProxy = false;
  ["finnhubKey", "twelveDataKey", "alphaVantageKey", "marketstackKey", "yahooRapidApiKey"].forEach((key) => {
    if (!merged[key] && defaultSettings[key]) merged[key] = defaultSettings[key];
  });
  return merged;
}

function loadJson(key, defaultValue) {
  try {
    return JSON.parse(localStorage.getItem(key)) || defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

function compactMoney(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1000000) return `$${(number / 1000000).toFixed(1)}M`;
  if (Math.abs(number) >= 1000) return `$${(number / 1000).toFixed(0)}K`;
  return money(number);
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function ratio(value) {
  return `${Number(value).toFixed(1)}:1`;
}

function slug(value) {
  return String(value).toLowerCase().replace("+", "plus");
}

function showToast(message) {
  const toast = document.querySelector("#toastTemplate").content.firstElementChild.cloneNode(true);
  toast.textContent = message;
  document.querySelector("#toastRegion").appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function setView(viewName) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector(`#${viewName}`).classList.add("active");
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  document.querySelector("#pageTitle").textContent = pageTitles[viewName];
  render();
}

async function runScan() {
  const button = document.querySelector("#scanButton");
  state.scanning = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Scanning...";
  }
  render();
  try {
    state.dataStatus.serverStatus = await checkServerStatus();
    const result = await loadCandidates(scanSettings());
    state.candidates = result.candidates;
    state.dataStatus = {
      source: result.source,
      warning: result.warning,
      lastScan: new Date().toLocaleString(),
      marketContext: result.marketContext,
      scanSummary: result.scanSummary,
      serverStatus: state.dataStatus.serverStatus
    };
    if (!state.candidates.some((candidate) => candidate.ticker === state.selectedTicker)) {
      state.selectedTicker = state.candidates[0]?.ticker || null;
    }
    showToast(`Scan complete: ${state.candidates.length} candidates found from ${result.source}.`);
  } catch (error) {
    state.dataStatus.warning = error.message;
    showToast("Scan failed. Check your live-data settings.");
  } finally {
    state.scanning = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Scan Market";
    }
    render();
  }
}

async function checkServerStatus() {
  if (location.protocol === "file:") {
    return {
      active: false,
      message: "Static app mode is active. No local server is needed."
    };
  }
  return {
    active: false,
    message: "Static hosted mode is active. No local server is needed."
  };
}

function scanSettings() {
  return {
    ...state.settings,
    useServerProxy: false,
    accountSize: Math.max(0, accountProgress().currentBalance)
  };
}

function currentCandidate() {
  return state.candidates.find((candidate) => candidate.ticker === state.selectedTicker) || state.candidates[0];
}

function render() {
  renderDashboard();
  renderCandidates();
  renderDetail();
  renderPlans();
  renderJournal();
  renderProgress();
  renderStats();
  renderSettings();
}

function renderDashboard() {
  const groups = candidateGroups();
  const progress = accountProgress();
  document.querySelector("#dashboard").innerHTML = `
    <div class="grid stats-grid">
      ${metric("Starting account", money(state.settings.startingBalance))}
      ${metric("Current paper balance", money(progress.currentBalance))}
      ${metric("Risk per trade", `${state.settings.riskPercent}% (${money(maxDollarRisk(scanSettings()))})`)}
      ${metric("Learning list", state.candidates.length)}
      ${metric("Approved / Watch / Study", `${groups.approved.length} / ${groups.watch.length} / ${groups.study.length}`)}
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Market Overview</h2>
      <div class="badge-row" style="margin-bottom:12px">
        <span class="badge info">${state.dataStatus.source}</span>
        <span class="badge info">${state.dataStatus.lastScan || "Ready"}</span>
      </div>
      <p class="subtle">Live-data scan focused only on long-only Momentum Breakout and Pullback Breakout setups from ${money(state.settings.minPrice)} to ${money(state.settings.maxPrice)}. No options, short selling, RSI, MACD, Bollinger Bands, or crypto.</p>
      <p class="subtle">${serverStatusText()}</p>
      ${state.dataStatus.warning ? `<p class="warning">${state.dataStatus.warning}</p>` : ""}
      <p><strong>Beginner rule:</strong> A stock can be not approved to trade and still be useful to study. Only Approved setups are trade-plan candidates; Watch and Study setups are for learning.</p>
    </div>
    ${marketContextPanel(state.dataStatus.marketContext)}
    ${scanSummaryPanel(state.dataStatus.scanSummary)}
    ${state.candidates.length && !groups.approved.length ? `<div class="empty" style="margin-top:16px">No approved trades today, but here are the best setups to study.</div>` : ""}
    ${!state.candidates.length ? `<div class="empty" style="margin-top:16px">${state.scanning ? "Scanning the live watchlist..." : "No approved trades found. That does not mean there is nothing to learn. Review the learning setups below after the next scan."}</div>` : ""}
    ${candidateSection("Top Approved Setups", groups.approved.slice(0, 5), "No approved trades found. That does not mean there is nothing to learn. Review the Watch and Study setups below.")}
    ${candidateSection("Watchlist Setups", groups.watch.slice(0, 10), "No Watch setups reached the 65 score area on this scan.")}
    ${candidateSection("Study Candidates", groups.study.slice(0, 10), "No Study candidates reached the learning-mode score floor on this scan.")}
    ${rejectedSection(groups.rejected)}
  `;
}

function candidateGroups(candidates = state.candidates) {
  return {
    approved: candidates.filter((candidate) => candidate.learningGroup === "Approved Trade Plan" || candidate.status === "Approved"),
    watch: candidates.filter((candidate) => candidate.learningGroup === "Watchlist Setup"),
    study: candidates.filter((candidate) => candidate.learningGroup === "Learning Candidate"),
    rejected: candidates.filter((candidate) => candidate.learningGroup === "Rejected")
  };
}

function candidateSection(title, candidates, emptyText) {
  if (!candidates.length) {
    return `
      <section class="candidate-section">
        <h2>${title}</h2>
        <div class="empty">${emptyText}</div>
      </section>
    `;
  }
  return `
    <section class="candidate-section">
      <h2>${title}</h2>
      <div class="grid candidate-grid">
        ${candidates.map(candidateCard).join("")}
      </div>
    </section>
  `;
}

function rejectedSection(candidates) {
  if (!candidates.length) return "";
  return `
    <details class="candidate-section rejected-details" ${state.settings.showRejectedCandidates ? "open" : ""}>
      <summary>
        <span>Skip Setups</span>
        <span class="badge reject">${candidates.length}</span>
      </summary>
      <p class="subtle">These are not worth paper trading, but the rejection reason can still teach you what to avoid. The debug section calls these Rejected for scanner troubleshooting.</p>
      <div class="grid candidate-grid">
        ${candidates.map(candidateCard).join("")}
      </div>
    </details>
  `;
}

function scanSummaryPanel(summary) {
  if (!summary) {
    return `
      <div class="card" style="margin-top:16px">
        <h2>Scan Summary</h2>
        <p class="subtle">Scanning more stocks helps find opportunities, but it does not mean you should take more trades. The best result may still be no trade.</p>
      </div>
    `;
  }
  return `
    <div class="card" style="margin-top:16px">
      <h2>Scan Debug Summary</h2>
      <div class="badge-row">
        <span class="badge info">Symbols scanned: ${summary.symbolsScanned}</span>
        <span class="badge info">Removed by price: ${summary.filteredByPrice}</span>
        <span class="badge info">Removed by volume: ${summary.filteredByVolume}</span>
        <span class="badge info">Removed by missing data: ${summary.filteredByMissingData || 0}</span>
        <span class="badge info">Removed by exchange/type: ${summary.filteredByUniverse || 0}</span>
        <span class="badge info">Scored candidates: ${summary.scoredCandidates || summary.candidatesFound}</span>
        <span class="badge approved">Approved: ${summary.approved}</span>
        <span class="badge watch">Watch: ${summary.watch || 0}</span>
        <span class="badge study">Study: ${summary.study || summary.learning || 0}</span>
        <span class="badge reject">Rejected: ${summary.rejected}</span>
        ${summary.displayed ? `<span class="badge info">Shown: ${summary.displayed}</span>` : ""}
      </div>
      ${debugReasonList(summary)}
      <p class="subtle" style="margin-top:12px">Scan broadly. Score patiently. Trade selectively. Waiting is a valid decision.</p>
    </div>
  `;
}

function debugReasonList(summary) {
  const reasons = summary.topRejectionReasons || [];
  if (!reasons.length) return `<p class="subtle" style="margin-top:12px">No rejection reasons have been collected yet.</p>`;
  return `
    <h3 style="margin-top:14px">Top rejection reasons</h3>
    <div class="badge-row">
      ${reasons.map((item) => `<span class="badge reject">${item.reason}: ${item.count}</span>`).join("")}
    </div>
  `;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function serverStatusText() {
  const status = state.dataStatus.serverStatus;
  if (status) return status.message;
  return location.protocol === "file:"
    ? "Easy local mode is active. The app will use live browser data without the local server."
    : "Checking server proxy status.";
}

function marketContextPanel(context) {
  if (!context) {
    return `
      <div class="card" style="margin-top:16px">
        <h2>Market Condition</h2>
        <p class="subtle">Scan the market to load SPY/QQQ context before planning long day trades.</p>
      </div>
    `;
  }
  const statusClass = context.status === "Trade allowed" ? "approved" : context.status === "Stand aside" ? "reject" : "watch";
  return `
    <div class="card" style="margin-top:16px">
      <div class="candidate-title">
        <div>
          <h2>Market Condition</h2>
          <p class="subtle">${context.lesson}</p>
        </div>
        <span class="badge ${statusClass}">${context.status}</span>
      </div>
      <div class="badge-row">
        ${context.indexes.map((item) => `<span class="badge info">${item.symbol}: ${item.bias} (${item.changePercent.toFixed(2)}%)</span>`).join("")}
      </div>
    </div>
  `;
}

function candidateCard(candidate) {
  const nonApproved = candidate.status !== "Approved";
  return `
    <article class="card">
      <div class="candidate-title">
        <div>
          <div class="ticker">${candidate.ticker}</div>
          <p class="subtle">${candidate.setupType} at ${money(candidate.price)}</p>
        </div>
        <div class="score">${candidate.score}</div>
      </div>
      <div class="badge-row">
        <span class="badge ${learningGroupClass(candidate)}">${candidate.displayLabel || candidate.learningGroup || candidate.status}</span>
        <span class="badge ${slug(candidate.rating)}">${candidate.rating}</span>
        <span class="badge info">${ratio(candidate.rr)}</span>
        <span class="badge ${candidate.dayTradeChecks?.accountFit ? "approved" : "reject"}">$100 fit</span>
        <span class="badge ${targetStatusClass(candidate.targetValidation?.standard.status)}">${candidate.targetValidation?.standard.status || "Target check"}</span>
        <span class="badge ${candidate.gapCheck?.color || "watch"}">${candidate.gapCheck?.status || "Gap check"}</span>
      </div>
      <p class="subtle"><strong>${candidate.setupLiveStatus || "Waiting for Breakout"}:</strong> ${setupStatusMessage(candidate)}</p>
      <p style="margin-top:14px">Entry trigger ${money(candidate.entry)}, stop ${money(candidate.stop)}, standard target ${money(candidate.standardTarget || candidate.target1)}.</p>
      <p class="subtle">Base score ${candidate.baseScore ?? candidate.score}, target adjustment ${signedNumber(candidate.targetValidation?.adjustment || 0)}, final ${candidate.score}.</p>
      <p class="subtle">Gap ${percent(candidate.latestGapPercent)} | Dollar volume ${compactMoney(candidate.dollarVolume)} | Risk/share ${money(candidate.riskPerShare || 0)}</p>
      <p class="subtle">${candidate.status === "Approved" ? "This is worth planning, but only if the trading session confirms the trigger." : learningSummary(candidate)}</p>
      ${nonApproved ? compactLearningReasons(candidate) : ""}
      <div class="actions">
        <button class="secondary-action" type="button" onclick="openDetail('${candidate.ticker}')">View setup</button>
        <button class="primary-action" type="button" onclick="savePlan('${candidate.ticker}')">Save plan</button>
        ${candidate.status === "Approved" ? `<button class="secondary-action" type="button" onclick="copyTradingViewPlan('${candidate.ticker}')">Create TradingView Plan</button>` : ""}
        ${candidate.status === "Approved" ? `<button class="secondary-action" type="button" onclick="openTradingView('${candidate.ticker}')">Open TV</button>` : ""}
      </div>
    </article>
  `;
}

function learningGroupClass(candidate) {
  const group = candidate.learningGroup || candidate.status;
  if (group === "Approved Trade Plan" || group === "Approved") return "approved";
  if (group === "Watchlist Setup" || group === "Watch") return "watch";
  if (group === "Learning Candidate") return "study";
  return "reject";
}

function learningSummary(candidate) {
  const reasons = learningExplanation(candidate);
  return `${candidate.ticker} is worth studying because ${reasons.interesting[0].toLowerCase()} It is not approved yet because ${reasons.notApproved[0].toLowerCase()}`;
}

function compactLearningReasons(candidate) {
  const reasons = learningExplanation(candidate);
  return `
    <div class="learning-mini">
      <p><strong>Why interesting:</strong> ${reasons.interesting[0]}</p>
      <p><strong>Needs improvement:</strong> ${reasons.improve[0]}</p>
      <p><strong>Watch tomorrow:</strong> ${reasons.tomorrow[0]}</p>
    </div>
  `;
}

function learningExplanation(candidate) {
  const interesting = qualificationReasons(candidate);
  const notApproved = concernReasons(candidate);
  return {
    interesting: interesting.length ? interesting : [`${candidate.ticker} has enough recent price action to compare against the rules.`],
    notApproved: notApproved.length ? notApproved : ["It has not passed every beginner trade-plan rule yet."],
    improve: improvementReasons(candidate),
    tomorrow: tomorrowWatchReasons(candidate)
  };
}

function improvementReasons(candidate) {
  const items = [];
  if (candidate.score < 50) items.push("The setup needs a stronger chart score before it belongs on the study list.");
  if (candidate.score >= 50 && candidate.score < 65) items.push("The score needs to improve into the Watch zone.");
  if (candidate.score >= 65 && candidate.score < 80) items.push("The score needs to improve into the 80+ approval zone.");
  if (candidate.rr < 1.9) items.push("The target needs to offer closer to 2:1 reward compared with the stop.");
  if (!candidate.dayTradeChecks?.accountFit) items.push("The stop needs to tighten or the share size needs to fit the current account.");
  if (!candidate.dayTradeChecks?.liquidityFit) items.push("Volume and dollar volume need to improve.");
  if (!candidate.dayTradeChecks?.gapFit) items.push("Price needs to avoid a large gap or chase entry.");
  if (candidate.targetValidation?.standard.status === "Low Probability" || candidate.targetValidation?.standard.status === "Unrealistic") items.push("The chart needs more room before major resistance.");
  if (candidate.stopValidation?.status === "Too Wide" || candidate.stopValidation?.status === "Wide") items.push("The setup needs a cleaner structure stop with less risk per share.");
  if (candidate.extended) items.push("Price needs to cool off instead of staying stretched.");
  if (!items.length) items.push("It needs a cleaner trigger and confirmation before becoming a paper trade plan.");
  return items;
}

function tomorrowWatchReasons(candidate) {
  const items = [
    `Watch whether price can break and hold above ${money(candidate.entry)}.`,
    `Watch whether volume improves above the recent average near ${compactMoney(candidate.averageVolume)} shares.`,
    `Watch whether price respects support near ${money(candidate.support)} instead of losing structure.`
  ];
  if (candidate.targetValidation?.standard.status !== "Reachable") items.push("Watch whether resistance clears enough space for the standard target.");
  if (!candidate.dayTradeChecks?.accountFit) items.push("Watch whether a tighter stop develops that fits the $100 account better.");
  return items;
}

function renderCandidates() {
  const tableCandidates = state.settings.showRejectedCandidates
    ? state.candidates
    : state.candidates.filter((candidate) => candidate.learningGroup !== "Rejected");
  document.querySelector("#candidates").innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h2>Candidate Groups</h2>
      <p class="subtle">Approved setups are the only trade-plan candidates. Watch and Study setups stay visible so you can study what is close, what failed, and what needs to improve.</p>
      <div class="badge-row">
        <span class="badge approved">Approved Trade Plan: 80+ and all rules pass</span>
        <span class="badge watch">Watch: 65-79</span>
        <span class="badge study">Study: 50-64</span>
        <span class="badge reject">Skip: below 50</span>
      </div>
    </div>
    <table class="candidate-table">
      <thead>
        <tr>
          <th>Ticker</th><th>Group</th><th>Price</th><th>Setup</th><th>Score</th><th>Live</th><th>Target</th><th>Rating</th><th>Status</th><th>Day Fit</th><th>R/R</th><th>Entry</th><th>Stop</th><th>Targets</th>
        </tr>
      </thead>
      <tbody>
        ${tableCandidates.map((candidate) => `
          <tr>
            <td><button class="link-button" type="button" onclick="openDetail('${candidate.ticker}')">${candidate.ticker}</button></td>
            <td><span class="badge ${learningGroupClass(candidate)}">${candidate.displayLabel || candidate.learningGroup || candidate.status}</span></td>
            <td>${money(candidate.price)}</td>
            <td>${candidate.setupType}</td>
            <td>${candidate.score} <span class="subtle">(${signedNumber(candidate.targetValidation?.adjustment || 0)})</span></td>
            <td>${candidate.setupLiveStatus || "Waiting"}</td>
            <td><span class="badge ${targetStatusClass(candidate.targetValidation?.standard.status)}">${candidate.targetValidation?.standard.status || "Review"}</span></td>
            <td><span class="badge ${slug(candidate.rating)}">${candidate.rating}</span></td>
            <td><span class="badge ${learningGroupClass(candidate)}">${candidate.displayLabel || candidate.status}</span></td>
            <td><span class="badge ${candidate.dayTradeChecks?.accountFit && candidate.dayTradeChecks?.liquidityFit && candidate.dayTradeChecks?.gapFit ? "approved" : "watch"}">${candidate.dayTradeChecks?.accountFit && candidate.dayTradeChecks?.liquidityFit && candidate.dayTradeChecks?.gapFit ? "Ready" : "Review"}</span></td>
            <td>${ratio(candidate.rr)}</td>
            <td>${money(candidate.entry)}</td>
            <td>${money(candidate.stop)}</td>
            <td>${money(candidate.conservativeTarget)} / ${money(candidate.standardTarget)} / ${money(candidate.aggressiveTarget)}</td>
          </tr>
        `).join("") || `<tr><td colspan="14">Press Scan Market to create the candidate list.</td></tr>`}
      </tbody>
    </table>
  `;
}

function openDetail(ticker) {
  state.selectedTicker = ticker;
  setView("detail");
}

function renderDetail() {
  const candidate = currentCandidate();
  if (!candidate) {
    document.querySelector("#detail").innerHTML = `<div class="empty">Press Scan Market, then choose a candidate to inspect.</div>`;
    return;
  }
  document.querySelector("#detail").innerHTML = `
    <div class="grid two-column">
      <div class="chart-wrap">
        <div class="chart-toolbar">
          <div class="badge-row">
            <span class="badge ${learningGroupClass(candidate)}">${candidate.displayLabel || candidate.learningGroup || candidate.status}</span>
            <span class="badge info">${candidate.setupType}</span>
            <span class="badge ${slug(candidate.rating)}">${candidate.rating} setup</span>
            <span class="badge info">${state.chart.candlesVisible} candles</span>
          </div>
          <div class="chart-controls" aria-label="Chart controls">
            <button class="secondary-action compact-action" type="button" onclick="changeChartZoom(-1)">Zoom in</button>
            <button class="secondary-action compact-action" type="button" onclick="changeChartZoom(1)">Zoom out</button>
            <button class="secondary-action compact-action" type="button" onclick="toggleChartLabels()">${state.chart.showLabels ? "Hide levels" : "Show levels"}</button>
          </div>
        </div>
        ${renderChart(candidate)}
      </div>
      <aside class="detail-stack">
        <div class="card">
          <h2>${candidate.ticker} Plan</h2>
          <div class="line-row"><strong>Entry:</strong> ${money(candidate.entry)}</div>
          <div class="line-row"><strong>Stop:</strong> ${money(candidate.stop)}</div>
          <div class="line-row"><strong>Targets:</strong> ${money(candidate.conservativeTarget)} / ${money(candidate.standardTarget)} / ${money(candidate.aggressiveTarget)}</div>
          <div class="line-row"><strong>Shares:</strong> ${candidate.shares}</div>
          <div class="line-row"><strong>Max loss:</strong> ${money(candidate.maxLoss)}</div>
          <div class="line-row"><strong>Base/final score:</strong> ${candidate.baseScore} -> ${candidate.score} (${signedNumber(candidate.targetValidation?.adjustment || 0)})</div>
          <div class="line-row"><strong>Dollar volume:</strong> ${compactMoney(candidate.dollarVolume)}</div>
          <div class="line-row"><strong>Latest gap:</strong> ${percent(candidate.latestGapPercent)}</div>
          <button class="primary-action" type="button" onclick="savePlan('${candidate.ticker}')" style="margin-top:12px">Save plan</button>
        </div>
        <div class="card">
          <h2>TradingView Handoff</h2>
          <p class="subtle">${candidate.status === "Approved" ? "This setup passed the current filters. Copy the plan, open TradingView, then paste it into your notes before paper trading." : "This setup has not passed all filters yet. Study it first before using it in TradingView."}</p>
          <div class="actions">
            <button class="secondary-action" type="button" onclick="copyTradingViewPlan('${candidate.ticker}')">Create TradingView Plan</button>
            <button class="secondary-action" type="button" onclick="openTradingView('${candidate.ticker}')">Open TradingView</button>
          </div>
        </div>
        <div class="card">
          <h2>AI Chart Coach</h2>
          <p>If price breaks and holds above ${money(candidate.entry)}, this becomes a valid paper trade setup. The stop at ${money(candidate.stop)} defines the risk before the trade is taken.</p>
          <ul class="lesson-list">${chartCoachLessons(candidate).map((item) => `<li>${item}</li>`).join("")}</ul>
        </div>
      </aside>
    </div>
    <div class="grid candidate-grid" style="margin-top:16px">
      ${beginnerTradePlanCard(candidate)}
      ${stopAccountGapSection(candidate)}
      ${candidate.status !== "Approved" ? learningExplanationSection(candidate) : ""}
      ${reasonCard("Why it qualified", qualificationReasons(candidate))}
      ${reasonCard("Concerns", concernReasons(candidate))}
      ${reasonCard("What must happen before entry", [
        `Price must trade above ${money(candidate.entry)} and hold, not just briefly poke through.`,
        "Volume should be at least normal or clearly increasing.",
        "The broader market should not be very weak."
      ])}
      ${reasonCard("When to skip", [
        "Skip if price gaps too far above the entry trigger.",
        "Skip if the breakout fails immediately.",
        "Skip if the bid/ask spread is too wide.",
        "Skip if you feel tempted to chase instead of following the plan.",
        "Skip if SPY/QQQ are weak and long setups are failing."
      ])}
      ${reasonCard("Day-Trading Checklist", dayTradeChecklist(candidate))}
      ${targetValidationSection(candidate)}
    </div>
`;
}

function learningExplanationSection(candidate) {
  const explanation = learningExplanation(candidate);
  return `
    <div class="card">
      <h2>Why This Is a Learning Setup</h2>
      <p class="subtle">${learningSummary(candidate)}</p>
      <h3>Why it is interesting</h3>
      <ul class="lesson-list">${explanation.interesting.slice(0, 3).map((item) => `<li>${item}</li>`).join("")}</ul>
      <h3 style="margin-top:14px">Why it is not approved</h3>
      <ul class="lesson-list">${explanation.notApproved.slice(0, 4).map((item) => `<li>${item}</li>`).join("")}</ul>
      <h3 style="margin-top:14px">What would need to improve</h3>
      <ul class="lesson-list">${explanation.improve.slice(0, 4).map((item) => `<li>${item}</li>`).join("")}</ul>
      <h3 style="margin-top:14px">What to watch tomorrow</h3>
      <ul class="lesson-list">${explanation.tomorrow.slice(0, 4).map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>
  `;
}

function beginnerTradePlanCard(candidate) {
  return `
    <div class="card">
      <h2>Beginner Trade Plan</h2>
      <div class="line-row"><strong>Ticker:</strong> ${candidate.ticker}</div>
      <div class="line-row"><strong>Setup:</strong> ${candidate.setupType}</div>
      <div class="line-row"><strong>Score:</strong> ${candidate.score}</div>
      <div class="line-row"><strong>Status:</strong> ${candidate.setupLiveStatus}</div>
      <div class="line-row"><strong>Entry Trigger:</strong> ${money(candidate.entry)}</div>
      <div class="line-row"><strong>Stop:</strong> ${money(candidate.stop)}</div>
      <div class="line-row"><strong>Targets:</strong> ${money(candidate.conservativeTarget)} / ${money(candidate.standardTarget)} / ${money(candidate.aggressiveTarget)}</div>
      <div class="line-row"><strong>Shares:</strong> ${candidate.shares}</div>
      <div class="line-row"><strong>Max Loss:</strong> ${money(candidate.maxLoss)}</div>
      <div class="line-row"><strong>Risk/Reward:</strong> ${ratio(candidate.rr)}</div>
      <div class="line-row"><strong>Fits My Account?</strong> ${candidate.accountFit?.status}</div>
      <div class="line-row"><strong>Gap Check:</strong> ${candidate.gapCheck?.status}</div>
      <div class="line-row"><strong>Target Validation:</strong> ${candidate.targetValidation?.standard.status}</div>
      <h3 style="margin-top:14px">Rules before entry</h3>
      <ul class="lesson-list">
        <li>Only paper trade if price breaks and holds above entry.</li>
        <li>Skip if price gaps too far above entry.</li>
        <li>Skip if volume is weak.</li>
        <li>Skip if spread is too wide.</li>
        <li>Do not chase.</li>
      </ul>
    </div>
  `;
}

function stopAccountGapSection(candidate) {
  const stopOptions = candidate.stopValidation?.options || [];
  return `
    <div class="card">
      <h2>Stop, Account, and Gap Check</h2>
      <p><strong>Fits My Account?</strong> <span class="badge ${accountFitClass(candidate.accountFit?.status)}">${candidate.accountFit?.status || "Review"}</span></p>
      <p class="subtle">${candidate.accountFit?.explanation || ""}</p>
      <p><strong>Stop Quality:</strong> <span class="badge ${candidate.stopValidation?.status === "Too Wide" ? "reject" : candidate.stopValidation?.status === "Wide" ? "watch" : "approved"}">${candidate.stopValidation?.status || "Review"}</span></p>
      <p class="subtle">${candidate.stopValidation?.explanation || ""} Risk is ${percent(candidate.stopValidation?.riskPercentOfEntry)} of entry.</p>
      <ul class="lesson-list">${stopOptions.map((option) => `<li>${option.label}: ${money(option.price)} - ${option.reason}</li>`).join("")}</ul>
      <p><strong>Gap Check:</strong> <span class="badge ${candidate.gapCheck?.color || "watch"}">${candidate.gapCheck?.status || "Review"}</span></p>
      <p class="subtle">${candidate.gapCheck?.explanation || ""}</p>
    </div>
  `;
}

function accountFitClass(status) {
  if (status === "Good Fit") return "approved";
  if (status === "Small Size Only") return "watch";
  return "reject";
}

function setupStatusMessage(candidate) {
  const messages = {
    "Waiting for Breakout": "Price has not broken resistance yet. No breakout, no trade.",
    Triggered: "Price has traded above the trigger. Confirm it holds and still fits the plan.",
    Rejected: "Price reached resistance but failed to break through.",
    Invalidated: "Price broke below support or the setup structure failed.",
    "No Trade": "The setup never triggered and is no longer active."
  };
  return messages[candidate.setupLiveStatus] || "A setup is not a trade until price confirms.";
}

function reasonCard(title, items) {
  return `<div class="card"><h2>${title}</h2><ul class="lesson-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul></div>`;
}

function targetValidationSection(candidate) {
  const validation = candidate.targetValidation;
  if (!validation) return "";
  const rows = [validation.conservative, validation.standard, validation.aggressive];
  return `
    <div class="card">
      <h2>Can This Target Actually Be Reached?</h2>
      <div class="target-grid">
        ${rows.map((target) => `
          <div class="target-box">
            <strong>${target.label}</strong>
            <span class="target-price">${money(target.price)}</span>
            <span class="badge ${targetStatusClass(target.status)}">${target.status}</span>
            <p class="subtle">${target.reason}</p>
          </div>
        `).join("")}
      </div>
      <h3 style="margin-top:14px">Resistance Analysis</h3>
      <ul class="lesson-list">
        ${validation.resistanceZones.slice(0, 5).map((zone) => `<li>${money(zone.level)} - ${zone.type}: ${zone.reason}</li>`).join("") || "<li>No meaningful resistance zones were detected before the target area.</li>"}
      </ul>
      <h3 style="margin-top:14px">AI Explanation</h3>
      <p class="subtle">${validation.explanation}</p>
      <p class="subtle">${targetValidationLesson()}</p>
    </div>
  `;
}

function targetStatusClass(status) {
  if (status === "Reachable") return "approved";
  if (status === "Possibly Reachable") return "watch";
  return "reject";
}

function signedNumber(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number}`;
}

function dayTradeChecklist(candidate) {
  return [
    candidate.dayTradeChecks?.accountFit ? "Position size fits the current paper account." : "Stop distance is too wide for the current paper account.",
    candidate.dayTradeChecks?.liquidityFit ? "Dollar volume is strong enough for beginner paper-trading practice." : "Dollar volume is below the preferred liquidity filter.",
    candidate.dayTradeChecks?.gapFit ? "Latest gap is inside the beginner limit." : "Latest gap is too large; do not chase.",
    candidate.dayTradeChecks?.triggerFit ? "Entry remains a trigger above current price." : "Entry is no longer a proper trigger above current price.",
    candidate.dayTradeChecks?.extensionFit ? "Price is not too extended." : "Price is extended; wait for a cleaner setup."
  ];
}

function changeChartZoom(direction) {
  const zoomLevels = [8, 12, 18, 30, 45];
  const currentIndex = zoomLevels.indexOf(state.chart.candlesVisible);
  const nextIndex = Math.max(0, Math.min(zoomLevels.length - 1, currentIndex + direction));
  state.chart.candlesVisible = zoomLevels[nextIndex];
  renderDetail();
}

function toggleChartLabels() {
  state.chart.showLabels = !state.chart.showLabels;
  renderDetail();
}

function renderChart(candidate) {
  const candles = candidate.candles.slice(-state.chart.candlesVisible);
  const width = 980;
  const height = 520;
  const padLeft = 62;
  const padRight = 150;
  const padTop = 34;
  const padBottom = 42;
  const volumeHeight = 92;
  const chartBottom = height - padBottom - volumeHeight;
  const prices = candles.flatMap((candle) => [candle[1], candle[2], candidate.support, candidate.resistance, candidate.entry, candidate.stop, candidate.conservativeTarget || candidate.target1, candidate.standardTarget || candidate.target1, candidate.aggressiveTarget || candidate.target2]);
  const rangePadding = Math.max(0.08, (Math.max(...prices) - Math.min(...prices)) * 0.12);
  const min = Math.min(...prices) - rangePadding;
  const max = Math.max(...prices) + rangePadding;
  const xStep = (width - padLeft - padRight) / candles.length;
  const maxVolume = Math.max(...candles.map((candle) => candle[4]));
  const y = (price) => padTop + ((max - price) / (max - min)) * (chartBottom - padTop);
  const volumeY = height - padBottom - volumeHeight;
  const visibleLevels = [
    { value: candidate.aggressiveTarget || candidate.target2, color: "#b7791f", label: "Aggressive" },
    { value: candidate.standardTarget || candidate.target1, color: "#b7791f", label: "Standard" },
    { value: candidate.conservativeTarget || candidate.target1, color: "#d99a2b", label: "Conservative" },
    { value: candidate.entry, color: "#2563eb", label: "Entry trigger" },
    { value: candidate.resistance, color: "#6d5bd0", label: "Resistance" },
    { value: candidate.support, color: "#0f9f6e", label: "Support" },
    { value: candidate.stop, color: "#c2413a", label: "Stop loss" }
  ];
  const levelLabelPositions = spacedLevelLabels(visibleLevels, y, padTop + 16, chartBottom - 8);
  const line = (level) => `<line x1="${padLeft}" x2="${width - padRight}" y1="${y(level.value)}" y2="${y(level.value)}" stroke="${level.color}" stroke-width="2.5" stroke-dasharray="7 5"><title>${level.label} ${money(level.value)}</title></line>${state.chart.showLabels ? `<text class="level-label" x="${width - padRight + 10}" y="${levelLabelPositions.get(level.label)}">${level.label} ${money(level.value)}</text>` : ""}`;
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2] || last;
  const lastX = padLeft + (candles.length - 1) * xStep + xStep / 2;
  const priorX = padLeft + (candles.length - 2) * xStep + xStep / 2;
  const callouts = chartCallouts(candidate, candles, { lastX, priorX, y });
  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${candidate.ticker} candlestick chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
      <text class="chart-title" x="${padLeft}" y="22">${candidate.ticker} recent candle movement</text>
      ${visibleLevels.map(line).join("")}
      ${candles.map((candle, index) => {
        const [open, high, low, close, volume] = candle;
        const x = padLeft + index * xStep + xStep / 2;
        const up = close >= open;
        const color = up ? "#0f9f6e" : "#c2413a";
        const bodyY = Math.min(y(open), y(close));
        const bodyHeight = Math.max(3, Math.abs(y(open) - y(close)));
        const volHeight = (volume / maxVolume) * volumeHeight;
        const bodyWidth = Math.min(38, Math.max(22, xStep * 0.58));
        return `
          <line x1="${x}" x2="${x}" y1="${y(high)}" y2="${y(low)}" stroke="${color}" stroke-width="3"/>
          <rect x="${x - bodyWidth / 2}" y="${bodyY}" width="${bodyWidth}" height="${bodyHeight}" rx="3" fill="${color}"/>
          <rect x="${x - bodyWidth / 2}" y="${height - padBottom - volHeight}" width="${bodyWidth}" height="${volHeight}" fill="${up ? "#a7f3d0" : "#fecaca"}"/>
        `;
      }).join("")}
      <path d="M ${priorX} ${y(previous[3])} L ${lastX} ${y(last[3])}" stroke="#64748b" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
      <line x1="${padLeft}" x2="${width - padRight}" y1="${volumeY}" y2="${volumeY}" stroke="#d8dee9"/>
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#64748b"/>
        </marker>
      </defs>
    </svg>
    <div class="chart-note">Clean view: candles stay unobstructed. Use Show levels for right-side price labels; learning notes stay below the chart.</div>
    <div class="chart-coach-grid">
      ${callouts.map((item) => `
        <div class="mini-read coach-read">
          <strong>${item.title}</strong>
          <span>${item.text}</span>
        </div>
      `).join("")}
    </div>
    <div class="candle-reading-grid">
      ${candleReadingCards(candidate, candles).map((item) => `
        <div class="mini-read">
          <strong>${item.title}</strong>
          <span>${item.body}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function spacedLevelLabels(levels, y, minY, maxY) {
  const minGap = 18;
  const rows = levels
    .map((level) => ({ label: level.label, y: y(level.value) + 4 }))
    .sort((a, b) => a.y - b.y);
  rows.forEach((row, index) => {
    if (index === 0) row.y = Math.max(minY, row.y);
    else row.y = Math.max(row.y, rows[index - 1].y + minGap);
  });
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    rows[index].y = Math.min(rows[index].y, maxY - (rows.length - 1 - index) * minGap);
    if (index > 0) rows[index - 1].y = Math.min(rows[index - 1].y, rows[index].y - minGap);
  }
  return new Map(rows.map((row) => [row.label, row.y]));
}

function chartCallouts(candidate, candles, helpers) {
  const last = candles[candles.length - 1];
  const [open, high, low, close, volume] = last;
  const bodyDirection = close >= open ? "green close" : "red close";
  const avgVolume = averageNumber(candles.slice(0, -1).map((candle) => candle[4]));
  const volumeText = volume >= avgVolume * 1.25 ? "volume expanding" : volume < avgVolume * 0.8 ? "volume fading" : "normal volume";
  const bodyText = `${bodyDirection}: ${money(open)} to ${money(close)}`;
  return [
    {
      x: helpers.lastX - 150,
      y: Math.max(54, helpers.y(high) - 46),
      anchorX: helpers.lastX,
      anchorY: helpers.y(high),
      title: "Last candle",
      text: bodyText
    },
    {
      x: helpers.lastX - 130,
      y: Math.min(helpers.y(low) + 48, 355),
      anchorX: helpers.lastX,
      anchorY: helpers.y(low),
      title: "Wick range",
      text: `${money(low)} low to ${money(high)} high`
    },
    {
      x: 70,
      y: Math.max(70, helpers.y(candidate.entry) - 62),
      anchorX: 240,
      anchorY: helpers.y(candidate.entry),
      title: "Trigger",
      text: "wait for break and hold"
    },
    {
      x: 70,
      y: Math.min(helpers.y(candidate.stop) + 22, 365),
      anchorX: 240,
      anchorY: helpers.y(candidate.stop),
      title: "Risk line",
      text: "paper stop defines max risk"
    },
    {
      x: helpers.lastX - 260,
      y: 390,
      anchorX: helpers.lastX,
      anchorY: 400,
      title: "Volume",
      text: volumeText
    }
  ];
}

function renderCallout(callout) {
  return `
    <line x1="${callout.x + 72}" y1="${callout.y + 34}" x2="${callout.anchorX}" y2="${callout.anchorY}" stroke="#94a3b8" stroke-width="1.5"/>
    <rect class="callout-box" x="${callout.x}" y="${callout.y}" width="172" height="50" rx="8"/>
    <text class="callout-title" x="${callout.x + 10}" y="${callout.y + 19}">${callout.title}</text>
    <text class="callout-text" x="${callout.x + 10}" y="${callout.y + 38}">${callout.text}</text>
  `;
}

function candleReadingCards(candidate, candles) {
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2] || last;
  const [open, high, low, close, volume] = last;
  const move = close - previous[3];
  const body = close - open;
  const avgVolume = averageNumber(candles.slice(0, -1).map((candle) => candle[4]));
  return [
    {
      title: "Close-to-close move",
      body: `${move >= 0 ? "+" : ""}${money(move)} from the prior close.`
    },
    {
      title: "Candle body",
      body: `${body >= 0 ? "Buyers" : "Sellers"} controlled the body by ${money(Math.abs(body))}.`
    },
    {
      title: "Full candle range",
      body: `The candle traveled from ${money(low)} to ${money(high)}.`
    },
    {
      title: "Volume read",
      body: `${volume >= avgVolume ? "Above" : "Below"} recent average volume.`
    },
    {
      title: "Setup lesson",
      body: beginnerLesson(candidate)
    }
  ];
}

function chartCoachLessons(candidate) {
  const candles = candidate.candles.slice(-18);
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2] || last;
  const closeMove = last[3] - previous[3];
  const nearEntry = candidate.entry ? ((candidate.entry - candidate.price) / candidate.entry) * 100 : 0;
  return [
    `The last close moved ${closeMove >= 0 ? "up" : "down"} ${money(Math.abs(closeMove))} from the prior close.`,
    `The entry trigger is ${nearEntry >= 0 ? `${nearEntry.toFixed(1)}% above current price` : "already below current price, so skip chasing"}.`,
    `Support near ${money(candidate.support)} is the area price should avoid losing strength.`,
    `Resistance near ${money(candidate.resistance)} is the area price needs to prove it can clear.`,
    "Read the body first, then the wicks, then volume. That order keeps the chart from feeling noisy."
  ];
}

function averageNumber(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.reduce((sum, value) => sum + value, 0) / Math.max(1, usable.length);
}

function tradingViewUrl(ticker) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(ticker)}`;
}

function openTradingView(ticker) {
  window.open(tradingViewUrl(ticker), "_blank", "noopener,noreferrer");
}

async function copyTradingViewPlan(ticker) {
  const candidate = state.candidates.find((item) => item.ticker === ticker) || state.plans.find((plan) => plan.ticker === ticker);
  if (!candidate) return;
  const text = formatTradingViewPlan(candidate);
  const copied = await copyText(text);
  showToast(copied ? `${ticker} TradingView plan copied.` : "Could not copy automatically. Try again from a browser tab.");
}

function formatTradingViewPlan(item) {
  const status = item.status || "Saved Plan";
  const setupType = item.setupType || "Setup";
  const riskRewardText = item.rr ? ratio(item.rr) : "planned";
  const maxLoss = Number(item.maxLoss || 0);
  const shares = Number(item.shares || 0);
  return [
    `PAPER TRADE PLAN - ${item.ticker}`,
    `Status: ${status}`,
    `Setup: ${setupType}`,
    `Entry trigger: ${money(item.entry)}`,
    `Stop loss: ${money(item.stop)}`,
    `Conservative target: ${money(item.conservativeTarget || item.target1)}`,
    `Standard target: ${money(item.standardTarget || item.target1)}`,
    `Aggressive target: ${money(item.aggressiveTarget || item.target2)}`,
    `Standard target validation: ${item.targetValidation?.standard?.status || "Review in app"}`,
    `Target note: ${item.targetValidation?.standard?.reason || "Check resistance before paper trading."}`,
    `Shares: ${shares}`,
    `Max loss: ${money(maxLoss)}`,
    `Risk/reward: ${riskRewardText}`,
    `Timeframe: Daily plan / intraday paper execution`,
    "",
    "TradingView steps:",
    "1. Open ticker in TradingView.",
    "2. Use the Long Position tool to draw the plan.",
    "3. Set entry, stop, and target.",
    "4. Use Paper Trading only.",
    "5. Use a Stop order for breakout entries.",
    "6. Do not use Market order unless the trade already triggered and still fits the plan.",
    "",
    "Warning:",
    "If the order says MARKET before the trigger has happened, you are entering too early.",
    "",
    "Rules before entry:",
    "- Only paper trade if price breaks and holds above the entry trigger.",
    "- Skip if price gaps too far above entry.",
    "- Skip if volume is weak.",
    "- Skip if spread is too wide.",
    "- Do not chase.",
    "",
    "TradingView note:",
    "Paste this into chart notes or keep it beside the paper trading panel."
  ].join("\n");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the older selection-based copy method.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function savePlan(ticker) {
  const candidate = state.candidates.find((item) => item.ticker === ticker);
  if (!candidate) return;
  if (state.plans.some((plan) => plan.ticker === ticker)) {
    showToast(`${ticker} is already saved as a trade plan.`);
    return;
  }
  state.plans.push({
    id: crypto.randomUUID(),
    ticker,
    setupType: candidate.setupType,
    entry: candidate.entry,
    stop: candidate.stop,
    target1: candidate.target1,
    target2: candidate.target2,
    conservativeTarget: candidate.conservativeTarget,
    standardTarget: candidate.standardTarget,
    aggressiveTarget: candidate.aggressiveTarget,
    targetValidation: candidate.targetValidation,
    shares: candidate.shares,
    maxLoss: candidate.maxLoss,
    rr: candidate.rr,
    status: candidate.status,
    dollarVolume: candidate.dollarVolume,
    latestGapPercent: candidate.latestGapPercent,
    notes: "",
    checklist: [
      "Price broke and held above the trigger",
      "Volume is not weak",
      "Spread is reasonable",
      "Market is not very weak",
      "I am not chasing a gap"
    ]
  });
  saveJson(storageKeys.plans, state.plans);
    showToast(`${ticker} saved as a paper trade plan.`);
  render();
}

function renderPlans() {
  document.querySelector("#plans").innerHTML = `
    <div class="plan-list">
      ${state.plans.map((plan) => `
        <article class="card split-card">
          <div>
            <div class="ticker">${plan.ticker}</div>
            <p class="subtle">${plan.setupType}</p>
            <div class="badge-row">
              <span class="badge info">Entry ${money(plan.entry)}</span>
              <span class="badge info">Stop ${money(plan.stop)}</span>
              <span class="badge info">Std target ${money(plan.standardTarget || plan.target1)}</span>
              <span class="badge ${targetStatusClass(plan.targetValidation?.standard?.status)}">${plan.targetValidation?.standard?.status || "Target review"}</span>
              <span class="badge info">Shares ${plan.shares}</span>
              <span class="badge reject">Max loss ${money(plan.maxLoss)}</span>
            </div>
            <h3 style="margin-top:14px">Checklist before taking the paper trade</h3>
            <ul class="checklist">${plan.checklist.map((item) => `<li>${item}</li>`).join("")}</ul>
            <div class="actions" style="margin-top:14px">
              <button class="secondary-action" type="button" onclick="copyTradingViewPlan('${plan.ticker}')">Create TradingView Plan</button>
              <button class="secondary-action" type="button" onclick="openTradingView('${plan.ticker}')">Open TV</button>
            </div>
          </div>
          <button class="danger-action" type="button" onclick="deletePlan('${plan.id}')">Remove</button>
        </article>
        `).join("") || `<div class="empty">Saved candidates will appear here as conditional day-trade plans.</div>`}
    </div>
  `;
}

function deletePlan(id) {
  state.plans = state.plans.filter((plan) => plan.id !== id);
  saveJson(storageKeys.plans, state.plans);
  render();
}

function renderJournal() {
  document.querySelector("#journal").innerHTML = `
    <div class="grid two-column">
      <form class="form-panel" id="journalForm">
        <h2>Log a Paper Trade</h2>
        <div class="form-grid">
          ${input("date", "Date", "date")}
          ${input("ticker", "Ticker")}
          ${input("setupType", "Setup type")}
          ${input("setupScore", "Setup score", "number", "1")}
          ${input("marketCondition", "Market condition")}
          ${input("plannedEntry", "Planned entry", "number", "0.01")}
          ${input("stop", "Planned stop", "number", "0.01")}
          ${input("target", "Planned target", "number", "0.01")}
          ${input("actualEntry", "Actual entry", "number", "0.01")}
          ${input("exitPrice", "Exit price", "number", "0.01")}
          ${input("shares", "Shares", "number", "1")}
          ${input("maxPlannedLoss", "Max planned loss", "number", "0.01")}
          <label>Win/loss<select name="result"><option>Win</option><option>Loss</option><option>Breakeven</option></select></label>
          ${input("profitLoss", "Profit/loss", "number", "0.01")}
          <label>Rule grade<select name="ruleGrade"><option>A</option><option>B</option><option>C</option><option>D</option><option>F</option></select></label>
          ${input("screenshotBefore", "Screenshot before")}
          ${input("screenshotAfter", "Screenshot after")}
        </div>
        <div class="check-grid">
          <label><span><input type="checkbox" name="validEntry" checked /> Entry was valid</span></label>
          <label><span><input type="checkbox" name="followedPlan" checked /> Followed the plan</span></label>
          <label><span><input type="checkbox" name="didTrigger" /> Trade triggered</span></label>
          <label><span><input type="checkbox" name="noTradeDay" /> No-trade learning day</span></label>
          <label><span><input type="checkbox" name="volumeIncreased" /> Volume increased</span></label>
          <label><span><input type="checkbox" name="marketNotWeak" /> Market was not weak</span></label>
          <label><span><input type="checkbox" name="noLargeGap" /> No large gap above entry</span></label>
          <label><span><input type="checkbox" name="spreadAcceptable" /> Spread acceptable</span></label>
          <label><span><input type="checkbox" name="chasedTrade" /> I chased</span></label>
          <label><span><input type="checkbox" name="movedStop" /> I moved the stop</span></label>
          <label><span><input type="checkbox" name="exitedEarly" /> I exited early</span></label>
          <label><span><input type="checkbox" name="revengeTrade" /> Revenge trade</span></label>
        </div>
        <label style="margin-top:14px">What happened<textarea name="notes"></textarea></label>
        <label style="margin-top:14px">What I learned<textarea name="learned"></textarea></label>
        <button class="primary-action" type="submit" style="margin-top:14px">Save journal entry</button>
      </form>
      <div class="journal-list">
        ${state.journal.map((entry) => `
          <article class="card">
            <div class="candidate-title">
              <div><strong>${entry.date || "No date"} - ${entry.ticker || "Ticker"}</strong><p class="subtle">${entry.setupType || "Setup"} - ${entry.result}</p></div>
              <span class="badge ${Number(entry.profitLoss) >= 0 ? "approved" : "reject"}">${money(entry.profitLoss || 0)}</span>
            </div>
            <p>${entry.notes || "No notes yet."}</p>
            <p class="subtle">Lesson: ${entry.learned || "Add one lesson from the trade."}</p>
            <div class="badge-row">
              ${entry.validEntry ? `<span class="badge approved">Valid entry</span>` : `<span class="badge watch">Review entry</span>`}
              ${entry.noTradeDay ? `<span class="badge info">No-trade day</span>` : ""}
              ${entry.chasedTrade ? `<span class="badge reject">Chased</span>` : ""}
              ${entry.movedStop ? `<span class="badge reject">Moved stop</span>` : ""}
              ${entry.exitedEarly ? `<span class="badge watch">Exited early</span>` : ""}
            </div>
          </article>
        `).join("") || `<div class="empty">Journal entries will show here after you log paper trades.</div>`}
      </div>
    </div>
  `;
  document.querySelector("#journalForm").addEventListener("submit", saveJournalEntry);
}

function input(name, label, type = "text", step = "") {
  return `<label>${label}<input name="${name}" type="${type}" ${step ? `step="${step}"` : ""} /></label>`;
}

function saveJournalEntry(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const entry = Object.fromEntries(form.entries());
  entry.followedPlan = form.get("followedPlan") === "on";
  entry.validEntry = form.get("validEntry") === "on";
  entry.didTrigger = form.get("didTrigger") === "on";
  entry.noTradeDay = form.get("noTradeDay") === "on";
  entry.volumeIncreased = form.get("volumeIncreased") === "on";
  entry.marketNotWeak = form.get("marketNotWeak") === "on";
  entry.noLargeGap = form.get("noLargeGap") === "on";
  entry.spreadAcceptable = form.get("spreadAcceptable") === "on";
  entry.chasedTrade = form.get("chasedTrade") === "on";
  entry.movedStop = form.get("movedStop") === "on";
  entry.exitedEarly = form.get("exitedEarly") === "on";
  entry.revengeTrade = form.get("revengeTrade") === "on";
  entry.id = crypto.randomUUID();
  entry.createdAt = new Date().toISOString();
  state.journal.unshift(entry);
  saveJson(storageKeys.journal, state.journal);
  showToast("Journal entry saved.");
  render();
}

function accountTransactions() {
  const journalTransactions = state.journal.map((entry) => ({
    id: `journal-${entry.id}`,
    source: "Journal",
    date: entry.date || entry.createdAt || "",
    label: `${entry.ticker || "Trade"} ${entry.result || ""}`.trim(),
    amount: Number(entry.profitLoss || 0),
    notes: entry.notes || ""
  }));
  const manualTransactions = state.accountEntries.map((entry) => ({
    id: entry.id,
    source: "Manual",
    date: entry.date || entry.createdAt || "",
    label: entry.type,
    amount: Number(entry.amount || 0),
    notes: entry.notes || ""
  }));
  return [...journalTransactions, ...manualTransactions]
    .filter((entry) => Number.isFinite(entry.amount))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function accountProgress() {
  const startingBalance = Number(state.settings.startingBalance || 100);
  const transactions = accountTransactions();
  const totalProfitLoss = transactions.reduce((sum, entry) => sum + entry.amount, 0);
  const currentBalance = startingBalance + totalProfitLoss;
  const returnPercent = startingBalance ? (totalProfitLoss / startingBalance) * 100 : 0;
  return { startingBalance, transactions, totalProfitLoss, currentBalance, returnPercent };
}

function renderProgress() {
  const progress = accountProgress();
  const winners = progress.transactions.filter((entry) => entry.amount > 0).length;
  const losers = progress.transactions.filter((entry) => entry.amount < 0).length;
  document.querySelector("#progress").innerHTML = `
    <div class="grid stats-grid">
      ${metric("Starting balance", money(progress.startingBalance))}
      ${metric("Current balance", money(progress.currentBalance))}
      ${metric("Total P/L", money(progress.totalProfitLoss))}
      ${metric("Return", `${progress.returnPercent.toFixed(1)}%`)}
      ${metric("Profit entries", winners)}
      ${metric("Loss entries", losers)}
    </div>
    <div class="grid two-column" style="margin-top:16px">
      <form class="form-panel" id="accountEntryForm">
        <h2>Add Profit or Loss</h2>
        <div class="form-grid">
          ${input("date", "Date", "date")}
          <label>Entry type
            <select name="type">
              <option value="Profit">Profit</option>
              <option value="Loss">Loss</option>
              <option value="Deposit">Deposit</option>
              <option value="Withdrawal">Withdrawal</option>
            </select>
          </label>
          ${input("amount", "Amount", "number", "0.01")}
          ${input("label", "Ticker or label")}
        </div>
        <label style="margin-top:14px">Notes<textarea name="notes"></textarea></label>
        <button class="primary-action" type="submit" style="margin-top:14px">Add to progress</button>
      </form>
      <div class="journal-list">
        ${progress.transactions.map((entry) => `
          <article class="card split-card">
            <div>
              <strong>${entry.date || "No date"} - ${entry.label || entry.source}</strong>
              <p class="subtle">${entry.source}${entry.notes ? ` - ${entry.notes}` : ""}</p>
              <span class="badge ${entry.amount >= 0 ? "approved" : "reject"}">${money(entry.amount)}</span>
            </div>
            ${entry.source === "Manual" ? `<button class="danger-action" type="button" onclick="deleteAccountEntry('${entry.id}')">Remove</button>` : ""}
          </article>
        `).join("") || `<div class="empty">Add a profit or loss entry here, or log trades in the Journal, to track account progress from ${money(progress.startingBalance)}.</div>`}
      </div>
    </div>
  `;
  document.querySelector("#accountEntryForm").addEventListener("submit", saveAccountEntry);
}

function saveAccountEntry(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const type = form.get("type");
  const rawAmount = Math.abs(Number(form.get("amount") || 0));
  const signedAmount = type === "Loss" || type === "Withdrawal" ? -rawAmount : rawAmount;
  state.accountEntries.unshift({
    id: crypto.randomUUID(),
    date: form.get("date"),
    type: form.get("label") || type,
    amount: signedAmount,
    notes: form.get("notes"),
    createdAt: new Date().toISOString()
  });
  saveJson(storageKeys.accountEntries, state.accountEntries);
  showToast("Account progress updated.");
  render();
}

function deleteAccountEntry(id) {
  state.accountEntries = state.accountEntries.filter((entry) => entry.id !== id);
  saveJson(storageKeys.accountEntries, state.accountEntries);
  render();
}

function renderStats() {
  const trades = state.journal;
  const progress = accountProgress();
  const wins = trades.filter((trade) => trade.result === "Win");
  const losses = trades.filter((trade) => trade.result === "Loss");
  const totalWins = wins.reduce((sum, trade) => sum + Number(trade.profitLoss || 0), 0);
  const totalLosses = Math.abs(losses.reduce((sum, trade) => sum + Number(trade.profitLoss || 0), 0));
  const setupCounts = trades.reduce((counts, trade) => {
    counts[trade.setupType] = (counts[trade.setupType] || 0) + 1;
    return counts;
  }, {});
  const bestSetup = Object.entries(setupCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "None yet";
  const followed = trades.filter((trade) => trade.followedPlan).length;
  const validEntries = trades.filter((trade) => trade.validEntry).length;
  const noTradeDays = trades.filter((trade) => trade.noTradeDay).length;
  const chased = trades.filter((trade) => trade.chasedTrade).length;
  const movedStops = trades.filter((trade) => trade.movedStop).length;
  document.querySelector("#stats").innerHTML = `
    <div class="grid stats-grid">
      ${metric("Total paper trades", trades.length)}
      ${metric("Win rate", trades.length ? `${Math.round((wins.length / trades.length) * 100)}%` : "0%")}
      ${metric("Average winner", wins.length ? money(totalWins / wins.length) : "$0.00")}
      ${metric("Average loser", losses.length ? money(totalLosses / losses.length) : "$0.00")}
      ${metric("Profit factor", totalLosses ? (totalWins / totalLosses).toFixed(2) : "0.00")}
      ${metric("Best setup type", bestSetup)}
      ${metric("Followed plan", `${followed} / ${trades.length}`)}
      ${metric("Broke plan", `${trades.length - followed} / ${trades.length}`)}
      ${metric("Valid entries", `${validEntries} / ${trades.length}`)}
      ${metric("No-trade days", noTradeDays)}
      ${metric("Chased trades", chased)}
      ${metric("Moved stops", movedStops)}
      ${metric("Current balance", money(progress.currentBalance))}
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Performance by Weekday</h2>
      <p class="subtle">${weekdaySummary(trades)}</p>
    </div>
  `;
}

function weekdaySummary(trades) {
  if (!trades.length) return "Add journal entries to see which weekdays are helping or hurting your paper trading.";
  const days = {};
  trades.forEach((trade) => {
    const day = trade.date ? new Date(`${trade.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }) : "Unknown";
    days[day] = (days[day] || 0) + Number(trade.profitLoss || 0);
  });
  return Object.entries(days).map(([day, value]) => `${day}: ${money(value)}`).join(" | ");
}

function renderSettings() {
  document.querySelector("#settings").innerHTML = `
    <form class="form-panel" id="settingsForm">
      <h2>Scanner Settings</h2>
      <div class="form-grid">
        ${settingInput("accountSize", "Account size", "number")}
        ${settingInput("startingBalance", "Starting balance", "number")}
        ${settingInput("riskPercent", "Risk percentage", "number")}
        <label>Scan mode
          <select name="scanMode">
            ${option("fast", "Fast Beginner Scan", state.settings.scanMode)}
            ${option("full", "Full Market Scan", state.settings.scanMode)}
          </select>
        </label>
        <label>Data mode<input name="dataMode" type="text" value="Live data only" disabled /></label>
        <label>Learning Mode
          <select name="learningMode">
            ${option("true", "On - show imperfect setups", String(state.settings.learningMode))}
            ${option("false", "Off - cleaner setups only", String(state.settings.learningMode))}
          </select>
        </label>
        <label>Beginner Strict Mode
          <select name="beginnerStrictMode">
            ${option("false", "Off - learning mode", String(state.settings.beginnerStrictMode))}
            ${option("true", "On - emphasize cleaner setups", String(state.settings.beginnerStrictMode))}
          </select>
        </label>
        <label>Show Skip Candidates
          <select name="showRejectedCandidates">
            ${option("false", "Off - collapsed", String(state.settings.showRejectedCandidates))}
            ${option("true", "On - expanded", String(state.settings.showRejectedCandidates))}
          </select>
        </label>
        ${settingInput("minPrice", "Minimum stock price", "number")}
        ${settingInput("maxPrice", "Maximum stock price", "number")}
        ${settingInput("minVolume", "Minimum volume", "number")}
        ${settingInput("minDollarVolume", "Minimum dollar volume", "number")}
        ${settingInput("minSetupScore", "Minimum display score", "number")}
        ${settingInput("maxCandidates", "Max candidates displayed", "number")}
        ${settingInput("maxSymbolsPerScan", "Max symbols per scan", "number")}
        ${settingInput("maxGapPercent", "Max latest gap %", "number")}
        ${settingInput("maxRiskPercentOfEntry", "Max risk % of entry", "number")}
        <label>Include ETFs
          <select name="includeEtfs">
            ${option("true", "Yes", String(state.settings.includeEtfs))}
            ${option("false", "No", String(state.settings.includeEtfs))}
          </select>
        </label>
        <label>Exclude leveraged ETFs
          <select name="excludeLeveragedEtfs">
            ${option("true", "Yes", String(state.settings.excludeLeveragedEtfs))}
            ${option("false", "No", String(state.settings.excludeLeveragedEtfs))}
          </select>
        </label>
        <label>Exclude inverse ETFs
          <select name="excludeInverseEtfs">
            ${option("true", "Yes", String(state.settings.excludeInverseEtfs))}
            ${option("false", "No", String(state.settings.excludeInverseEtfs))}
          </select>
        </label>
      </div>
      <h2 style="margin-top:22px">Live Data</h2>
      <div class="form-grid">
        <label>Provider
          <select name="dataProvider">
            ${option("auto", "Auto", state.settings.dataProvider)}
            ${option("yahoo", "Yahoo Finance", state.settings.dataProvider)}
            ${option("yahooRapid", "Yahoo RapidAPI", state.settings.dataProvider)}
            ${option("finnhub", "Finnhub", state.settings.dataProvider)}
            ${option("twelveData", "Twelve Data", state.settings.dataProvider)}
            ${option("marketstack", "Marketstack", state.settings.dataProvider)}
            ${option("alphaVantage", "Alpha Vantage", state.settings.dataProvider)}
          </select>
        </label>
        ${settingInput("finnhubKey", "Finnhub key", "password")}
        ${settingInput("twelveDataKey", "Twelve Data key", "password")}
        ${settingInput("marketstackKey", "Marketstack key", "password")}
        ${settingInput("alphaVantageKey", "Alpha Vantage key", "password")}
        ${settingInput("yahooRapidApiKey", "Yahoo RapidAPI key", "password")}
        ${settingInput("yahooRapidApiHost", "Yahoo RapidAPI host", "text")}
        ${settingInput("marketstackBaseUrl", "Marketstack base URL", "text")}
      </div>
      <label style="margin-top:14px">Watchlist symbols<textarea name="watchlist">${escapeHtml(state.settings.watchlist || "")}</textarea></label>
      <label style="margin-top:14px">Exchanges<textarea name="exchanges">${escapeHtml((state.settings.exchanges || []).join(", "))}</textarea></label>
      <label style="margin-top:14px">Market condition symbols<textarea name="marketBiasSymbols">${escapeHtml(state.settings.marketBiasSymbols || "")}</textarea></label>
      <p class="subtle" style="margin-top:12px">Keys are saved only in this browser's local storage. For a public static host, prefer public Yahoo data or host-level privacy controls; browser-entered provider keys are still used by the browser.</p>
      <button class="primary-action" type="submit" style="margin-top:14px">Save settings</button>
    </form>
  `;
  document.querySelector("#settingsForm").addEventListener("submit", saveSettings);
}

function settingInput(name, label, type) {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeAttribute(state.settings[name] || "")}" /></label>`;
}

function option(value, label, selected) {
  return `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.settings = {
    accountSize: Number(form.get("accountSize")),
    startingBalance: Number(form.get("startingBalance")),
    riskPercent: Number(form.get("riskPercent")),
    minPrice: Number(form.get("minPrice")),
    maxPrice: Number(form.get("maxPrice")),
    minVolume: Number(form.get("minVolume")),
    minDollarVolume: Number(form.get("minDollarVolume")),
    minSetupScore: Number(form.get("minSetupScore")),
    maxCandidates: Number(form.get("maxCandidates")),
    maxSymbolsPerScan: Number(form.get("maxSymbolsPerScan")),
    maxGapPercent: Number(form.get("maxGapPercent")),
    maxRiskPercentOfEntry: Number(form.get("maxRiskPercentOfEntry")),
    scanMode: form.get("scanMode"),
    dataMode: "live",
    learningMode: form.get("learningMode") === "true",
    beginnerStrictMode: form.get("beginnerStrictMode") === "true",
    showRejectedCandidates: form.get("showRejectedCandidates") === "true",
    includeEtfs: form.get("includeEtfs") === "true",
    excludeLeveragedEtfs: form.get("excludeLeveragedEtfs") === "true",
    excludeInverseEtfs: form.get("excludeInverseEtfs") === "true",
    useServerProxy: false,
    dataProvider: form.get("dataProvider"),
    watchlist: form.get("watchlist"),
    exchanges: String(form.get("exchanges") || "").split(",").map((item) => item.trim()).filter(Boolean),
    marketBiasSymbols: form.get("marketBiasSymbols"),
    finnhubKey: form.get("finnhubKey"),
    twelveDataKey: form.get("twelveDataKey"),
    marketstackKey: form.get("marketstackKey"),
    alphaVantageKey: form.get("alphaVantageKey"),
    yahooRapidApiKey: form.get("yahooRapidApiKey"),
    yahooRapidApiHost: form.get("yahooRapidApiHost"),
    marketstackBaseUrl: form.get("marketstackBaseUrl")
  };
  saveJson(storageKeys.settings, state.settings);
  runScan();
  showToast("Settings saved and market scan refreshed.");
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelector("#scanButton").addEventListener("click", runScan);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

initializeApp();
