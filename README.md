# Paper Trade Planner

A beginner-friendly stock trade planning and learning web app for paper trading. It uses live API market data, scans for simple long-only setups, explains each candidate in plain English, and lets a user save conditional day-trade plans and journal paper trades.

## How to Run

Easiest Windows option, no server:

```text
Double-click START HERE.bat
```

That opens the app directly in your browser and uses live data mode. Start here first.

Default app password:

```text
papertrade
```

To host it online without the server, see `HOSTING.md`.

## Mobile Use

The app includes a web app manifest and service worker so it can be installed to a phone home screen once hosted from a secure URL.

For phone use away from home, host the static app with GitHub Pages, Netlify, Cloudflare Pages, or another static host. The password screen is configured in `site-config.js`.

Important: a static app password is casual privacy, not deep security. For stronger privacy, use the hosting platform's access controls.

## What It Does

- Scans live watchlist data with the **Scan Market** button.
- Shows candidates without forcing a fixed number of trades.
- Supports only two beginner setups: Momentum Breakout and Pullback Breakout.
- Builds conditional paper trade plans with entry triggers, stops, targets, share size, and max loss.
- Shows a zoomed candle chart with AI Coach style annotations for body, wick, volume, support, resistance, trigger, stop, and targets.
- Includes chart zoom controls and a clean-chart toggle when labels get in the way.
- Starts account tracking at $100 by default.
- Tracks account progress from journaled trade P/L and manual profit/loss entries.
- Adds day-trading learning filters for SPY/QQQ market condition, latest gap size, dollar volume, and $100 account fit.
- Downgrades long setups to Watch when broad market context says to stand aside.
- Tracks discipline in the journal: valid entry, followed plan, no-trade day, chased trade, moved stop, and exited early.
- Copies approved trade plans into a TradingView-friendly note and opens the symbol chart in TradingView.
- Validates conservative, standard, and aggressive targets against resistance/supply zones before giving a setup a high score.
- Adds chart-based stop options: structure stop, tight breakout stop, and ATR-based stop.
- Adds Fits My Account status: Good Fit, Small Size Only, Poor Fit, or Does Not Fit.
- Adds setup live status: Waiting for Breakout, Triggered, Rejected, Invalidated, or No Trade.
- Adds gap-check status: Valid Entry Zone, Use Caution, Gap Too Large, or Waiting.
- Adds scan modes: Fast Beginner Scan and Full Market Scan scaffold with batch scanning, cached universe, and scan summary counts.
- Adds Learning Mode so imperfect Watch and Study setups remain visible instead of being hidden behind strict approval rules.
- Adds Scan Debug Summary with symbols scanned, hard-filter counts, scored candidates, category counts, and top rejection reasons.
- Adds mock learning examples for approved, waiting, rejected, invalidated, gap-too-large, poor-account-fit, realistic-target, and unrealistic-target setups.
- Stores settings, API keys, plans, and journal entries in browser local storage.
- Tracks simple stats such as win rate, average winner, average loser, profit factor, setup type, weekday performance, and followed-plan behavior.

## Scoring

Each setup uses a 100-point score made from five 20-point categories.

Momentum Breakout:

- Trend strength
- Volume above average
- Close near high of day
- Resistance breakout or close near resistance
- Risk/reward quality

Pullback Breakout:

- Existing uptrend
- Controlled pullback
- Support holding
- Buyers returning
- Risk/reward quality

Ratings:

- 95-100 = A+
- 90-94 = A
- 85-89 = B
- 80-84 = C
- Below 80 = Reject

Target validation can adjust the final score:

- +10 if the standard target is realistically achievable.
- +5 if the conservative target is reachable.
- -10 if the standard target is blocked by major resistance.
- -20 if the standard reward target is unrealistic.

The app now displays both the base technical score and final target-adjusted score.

The final score also considers stop width, account fit, gap status, liquidity, setup status, and whether the entry is based on current support/resistance.

## Approval Rules

A setup is approved only when:

- Score is 80 or higher.
- Risk/reward is near or above 2:1.
- Stop loss is clearly defined.
- Entry is a trigger above current price, not a market buy.
- Position size fits the account.
- Liquidity is acceptable.
- The setup is not too extended.

## Paper Trading Use

This app never says to buy a stock. It uses wording like: "If price breaks and holds above the entry trigger, this becomes a valid paper trade setup."

Before taking a paper trade, review the saved checklist. Skip a setup if price gaps too far, volume is weak, price fails after breaking out, spreads are wide, or the overall market is very weak.

## Educational Only

This is a paper-trading education tool that uses live API market data. It is not financial advice and should not be used for live trading decisions.

## Live Data

The Settings page includes a Live Data section. It supports:

- Yahoo Finance chart data
- Yahoo Finance through RapidAPI
- Finnhub
- Twelve Data
- Marketstack
- Alpha Vantage

Use Auto provider mode to try the available providers in order. Free data can be delayed, rate-limited, or blocked by browser CORS rules. When live data is unavailable, the app shows no candidates instead of displaying substitute data.

Browser-entered API keys are saved in local storage on that device. For the simplest static hosted setup, use public Yahoo data first. Do not put private keys into a public repository.

The strategy logic is separate from the UI in `strategy.js`, and provider adapters live in `api.js`.
