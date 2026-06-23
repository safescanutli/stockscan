function baseSetupScore(candidate) {
  return Object.values(candidate.scores).reduce((sum, value) => sum + value, 0);
}

function setupScore(candidate, targetValidation = validateTargets(candidate)) {
  const penalties = (candidate.stopValidation?.adjustment || 0) + (candidate.accountFit?.adjustment || 0) + (candidate.gapCheck?.adjustment || 0);
  return Math.max(0, Math.min(100, baseSetupScore(candidate) + targetValidation.adjustment + penalties));
}

function ratingForScore(score) {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "B";
  if (score >= 80) return "C";
  return "Reject";
}

function riskReward(candidate) {
  const risk = candidate.entry - candidate.stop;
  const reward = (candidate.standardTarget || candidate.target1) - candidate.entry;
  if (risk <= 0) return 0;
  return reward / risk;
}

function riskPerShare(candidate) {
  return candidate.entry - candidate.stop;
}

function maxDollarRisk(settings) {
  return settings.accountSize * (settings.riskPercent / 100);
}

function shareSize(candidate, settings) {
  const riskPerShare = candidate.entry - candidate.stop;
  if (riskPerShare <= 0) return 0;
  const shares = Math.floor(maxDollarRisk(settings) / riskPerShare);
  const buyingPowerShares = Math.floor(settings.accountSize / candidate.entry);
  return Math.max(0, Math.min(shares, buyingPowerShares));
}

function positionFits(candidate, settings) {
  return shareSize(candidate, settings) > 0;
}

function dayTradeChecks(candidate, settings) {
  const riskPerShare = candidate.entry - candidate.stop;
  const maxRisk = maxDollarRisk(settings);
  return {
    accountFit: positionFits(candidate, settings) && riskPerShare <= maxRisk,
    liquidityFit: candidate.liquidityOk && (candidate.dollarVolume || 0) >= (settings.minDollarVolume || 0),
    gapFit: candidate.gapCheck ? candidate.gapCheck.status !== "Gap Too Large" : Math.abs(candidate.latestGapPercent || 0) <= (settings.maxGapPercent || 3),
    triggerFit: candidate.entry > candidate.price,
    extensionFit: !candidate.extended,
    stopFit: candidate.stopValidation ? candidate.stopValidation.status !== "Too Wide" : true
  };
}

function dayTradeFit(candidate, settings) {
  const checks = dayTradeChecks(candidate, settings);
  return Object.values(checks).every(Boolean);
}

function statusForCandidate(candidate, settings, score = setupScore(candidate), targetValidation = validateTargets(candidate)) {
  const rr = riskReward(candidate);
  const standardStatus = targetValidation.standard.status;
  const targetOk = standardStatus === "Reachable" || standardStatus === "Possibly Reachable";
  if (standardStatus === "Unrealistic") return "Reject";
  if (candidate.stopValidation?.status === "Too Wide") return "Reject";
  if (candidate.accountFit?.status === "Does Not Fit") return "Reject";
  if (candidate.gapCheck?.status === "Gap Too Large") return "Reject";
  if (candidate.setupLiveStatus === "Invalidated") return "Reject";
  if (
    score >= 80 &&
    rr >= 1.9 &&
    candidate.stop < candidate.entry &&
    dayTradeFit(candidate, settings) &&
    targetOk
  ) {
    return "Approved";
  }
  if (score >= 60 && rr >= 1.2 && candidate.entry > candidate.price) {
    return "Watch";
  }
  return "Reject";
}

function enrichCandidate(candidate, settings) {
  const targetValidation = validateTargets(candidate);
  const stopValidation = validateStops(candidate, settings);
  const accountFit = accountFitScore(candidate, settings, stopValidation);
  const gapCheck = gapCheckStatus(candidate, settings);
  const setupLiveStatus = setupStatus(candidate);
  const baseScore = baseSetupScore(candidate);
  const withValidation = { ...candidate, targetValidation, stopValidation, accountFit, gapCheck, setupLiveStatus };
  const score = setupScore(withValidation, targetValidation);
  const checks = dayTradeChecks(withValidation, settings);
  return {
    ...candidate,
    baseScore,
    score,
    rating: ratingForScore(score),
    rr: riskReward({ ...candidate, standardTarget: targetValidation.standard.price }),
    status: statusForCandidate(withValidation, settings, score, targetValidation),
    shares: shareSize(candidate, settings),
    maxLoss: shareSize(candidate, settings) * (candidate.entry - candidate.stop),
    riskPerShare: candidate.entry - candidate.stop,
    targetValidation,
    stopValidation,
    accountFit,
    gapCheck,
    setupLiveStatus,
    conservativeTarget: targetValidation.conservative.price,
    standardTarget: targetValidation.standard.price,
    aggressiveTarget: targetValidation.aggressive.price,
    dayTradeChecks: checks
  };
}

function validateStops(candidate, settings) {
  const candles = candidate.candles || [];
  const recent = candles.slice(-12);
  const structureStop = roundPrice(Math.min(...recent.map((candle) => candle[2])) - candidate.entry * 0.002);
  const tightBreakoutStop = roundPrice(Math.min(candidate.resistance, candidate.entry) - candidate.entry * 0.006);
  const atrStop = roundPrice(candidate.entry - averageTrueRange(candles.slice(-14)) * 1.2);
  const options = [
    { label: "Structure Stop", price: structureStop, reason: "Below recent support or swing low." },
    { label: "Tight Breakout Stop", price: tightBreakoutStop, reason: "Below breakout level or failed breakout area." },
    { label: "ATR-Based Stop", price: atrStop, reason: "Based on recent candle volatility." }
  ]
    .filter((option) => Number.isFinite(option.price) && option.price > 0 && option.price < candidate.entry)
    .sort((a, b) => b.price - a.price);
  const currentRiskPercent = ((candidate.entry - candidate.stop) / candidate.entry) * 100;
  const status = currentRiskPercent > (settings.maxRiskPercentOfEntry || 8) ? "Too Wide" : currentRiskPercent > 5 ? "Wide" : "Acceptable";
  const adjustment = status === "Too Wide" ? -15 : status === "Wide" ? -5 : 5;
  return {
    status,
    adjustment,
    riskPercentOfEntry: currentRiskPercent,
    options,
    explanation: status === "Too Wide"
      ? "Good setup, but stop is too wide for a small-account day trade."
      : "The planned stop is within the beginner day-trade risk-width guardrail."
  };
}

function averageTrueRange(candles) {
  if (!candles.length) return 0;
  return candles.reduce((sum, candle, index) => {
    const previousClose = candles[index - 1]?.[3] || candle[0];
    return sum + Math.max(candle[1] - candle[2], Math.abs(candle[1] - previousClose), Math.abs(candle[2] - previousClose));
  }, 0) / candles.length;
}

function accountFitScore(candidate, settings, stopValidation) {
  const risk = riskPerShare(candidate);
  const maxRisk = maxDollarRisk(settings);
  const shares = shareSize(candidate, settings);
  let status = "Good Fit";
  let adjustment = 5;
  if (shares < 1) {
    status = "Does Not Fit";
    adjustment = -25;
  } else if (risk > maxRisk) {
    status = "Poor Fit";
    adjustment = -15;
  } else if (shares === 1 || stopValidation.status === "Wide") {
    status = "Small Size Only";
    adjustment = -5;
  }
  return {
    status,
    adjustment,
    maxRisk,
    shares,
    explanation: status === "Good Fit"
      ? "This setup fits the current paper account risk rules."
      : status === "Small Size Only"
        ? "This may fit only with very small size."
        : status === "Poor Fit"
          ? "Good chart, poor fit for current account size."
          : "One share risks more than the allowed max or cannot be sized safely."
  };
}

function gapCheckStatus(candidate, settings) {
  const gapFromEntry = ((candidate.price - candidate.entry) / candidate.entry) * 100;
  if (gapFromEntry < 0) {
    return { status: "Waiting", color: "watch", gapFromEntry, adjustment: 0, explanation: "Price is still below the trigger. No breakout, no trade." };
  }
  if (gapFromEntry <= 2) {
    return { status: "Valid Entry Zone", color: "approved", gapFromEntry, adjustment: 5, explanation: "Price is close enough to the planned entry zone to keep the plan valid." };
  }
  if (gapFromEntry <= 3) {
    return { status: "Use Caution", color: "watch", gapFromEntry, adjustment: -5, explanation: "Price is above the trigger. Use caution and do not chase." };
  }
  return { status: "Gap Too Large", color: "reject", gapFromEntry, adjustment: -20, explanation: "Gap too large. Do not chase." };
}

function setupStatus(candidate) {
  const last = candidate.candles?.[candidate.candles.length - 1];
  const previous = candidate.candles?.[candidate.candles.length - 2];
  if (!last) return "Waiting for Breakout";
  const close = last[3];
  const high = last[1];
  const low = last[2];
  if (low < candidate.support * 0.985 || close < candidate.support * 0.99) return "Invalidated";
  if (high >= candidate.resistance && close < candidate.resistance) return "Rejected";
  if (close >= candidate.entry || high >= candidate.entry) return "Triggered";
  if (previous && previous[1] >= candidate.entry && high < candidate.entry) return "No Trade";
  return "Waiting for Breakout";
}

function validateTargets(candidate) {
  const risk = riskPerShare(candidate);
  const targets = {
    conservative: buildTarget(candidate, "Conservative Target", risk, 1.5),
    standard: buildTarget(candidate, "Standard Target", risk, 2),
    aggressive: buildTarget(candidate, "Aggressive Target", risk, 3)
  };
  const resistanceZones = identifyResistanceZones(candidate);
  Object.values(targets).forEach((target) => {
    Object.assign(target, rateTarget(candidate.entry, target.price, resistanceZones));
  });
  const adjustment = targetScoreAdjustment(targets);
  return {
    ...targets,
    risk,
    resistanceZones,
    adjustment,
    explanation: targetValidationExplanation(targets, resistanceZones)
  };
}

function buildTarget(candidate, label, risk, multiple) {
  return {
    label,
    multiple,
    price: roundPrice(candidate.entry + risk * multiple)
  };
}

function identifyResistanceZones(candidate) {
  const candles = candidate.candles || [];
  const entry = candidate.entry;
  const zones = [];
  const addZone = (level, type, strength, reason) => {
    if (!Number.isFinite(level) || level <= entry * 1.002) return;
    const existing = zones.find((zone) => Math.abs(zone.level - level) / level < 0.012);
    if (existing) {
      existing.strength = Math.min(5, existing.strength + strength);
      existing.types.add(type);
      existing.reasons.push(reason);
      return;
    }
    zones.push({ level: roundPrice(level), type, strength, types: new Set([type]), reasons: [reason] });
  };

  candles.forEach((candle, index) => {
    const [open, high, low, close] = candle;
    const previous = candles[index - 1];
    const next = candles[index + 1];
    const body = Math.abs(close - open);
    const upperWick = high - Math.max(open, close);
    if (previous && next && high > previous[1] && high > next[1]) {
      addZone(high, "Swing high", 2, "Price previously made a local high and reversed.");
    }
    if (upperWick > Math.max(body * 1.3, high * 0.006) && close < open) {
      addZone(high, "Supply zone", 2, "A red candle with a long upper wick shows selling pressure.");
    }
    if (close < open && high > entry) {
      addZone(high, "Reversal area", 1, "Price previously rejected this area.");
    }
    if (low < candidate.resistance && close > candidate.resistance) {
      addZone(candidate.resistance, "Previous breakout level", 2, "Prior resistance may become a decision level.");
    }
  });

  addZone(candidate.resistance, "Recent resistance", 3, "This is the nearest resistance from recent price action.");
  weeklyHighs(candles).forEach((high) => addZone(high, "Weekly resistance", 3, "A five-session high can act like a weekly resistance zone."));

  return zones
    .map((zone) => ({
      ...zone,
      type: [...zone.types].join(", "),
      reason: zone.reasons[0]
    }))
    .sort((a, b) => a.level - b.level)
    .slice(0, 12);
}

function weeklyHighs(candles) {
  const highs = [];
  for (let index = 0; index < candles.length; index += 5) {
    const chunk = candles.slice(index, index + 5);
    if (chunk.length >= 3) highs.push(Math.max(...chunk.map((candle) => candle[1])));
  }
  return highs;
}

function rateTarget(entry, targetPrice, resistanceZones) {
  const blockers = resistanceZones.filter((zone) => zone.level > entry && zone.level < targetPrice);
  const majorBlockers = blockers.filter((zone) => zone.strength >= 3);
  const resistanceScore = blockers.reduce((sum, zone) => sum + zone.strength, 0);
  const firstMajor = majorBlockers[0];
  const move = targetPrice - entry;
  const firstMajorDistance = firstMajor ? (firstMajor.level - entry) / Math.max(move, 0.01) : 1;
  let status = "Reachable";
  let reason = "No major resistance appears between the entry trigger and this target.";

  if (majorBlockers.length >= 2 || resistanceScore >= 7) {
    status = "Unrealistic";
    reason = "Multiple significant resistance zones sit before this target.";
  } else if (majorBlockers.length === 1 && firstMajorDistance < 0.55) {
    status = "Low Probability";
    reason = "A major resistance zone appears before price has completed enough of the move.";
  } else if (blockers.length >= 2 || resistanceScore >= 4) {
    status = "Low Probability";
    reason = "Several resistance areas appear before this target.";
  } else if (blockers.length === 1) {
    status = "Possibly Reachable";
    reason = "One resistance area exists before the target, so price needs confirmation through that zone.";
  }

  return {
    status,
    reason,
    blockers
  };
}

function targetScoreAdjustment(targets) {
  if (targets.standard.status === "Unrealistic") return -20;
  if (targets.standard.status === "Low Probability") return -10;
  let adjustment = 0;
  if (targets.standard.status === "Reachable" || targets.standard.status === "Possibly Reachable") adjustment += 10;
  if (targets.conservative.status === "Reachable") adjustment += 5;
  if (targets.conservative.status === "Unrealistic") adjustment -= 20;
  return adjustment;
}

function targetValidationExplanation(targets, resistanceZones) {
  const blockerText = (target) => target.blockers.length
    ? `${target.blockers.length} resistance zone${target.blockers.length === 1 ? "" : "s"} before ${roundPrice(target.price)}`
    : `limited historical resistance before ${roundPrice(target.price)}`;
  return `The standard target of $${targets.standard.price.toFixed(2)} is ${targets.standard.status.toLowerCase()} because there is ${blockerText(targets.standard)}. The aggressive target of $${targets.aggressive.price.toFixed(2)} is ${targets.aggressive.status.toLowerCase()} and requires price to clear ${targets.aggressive.blockers.length} resistance area${targets.aggressive.blockers.length === 1 ? "" : "s"}.`;
}

function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

function qualificationReasons(candidate) {
  const reasons = [];
  if (candidate.score >= 85) reasons.push("The setup score is strong enough to be considered.");
  if (candidate.score >= 60 && candidate.score < 85) reasons.push("The chart has enough structure to study, even though it is not a clean trade plan.");
  if (candidate.rr >= 2) reasons.push("The first target offers at least 2:1 reward compared with the stop risk.");
  if (candidate.rr >= 1.2 && candidate.rr < 2) reasons.push("There is some reward potential, but it is not strong enough for a clean beginner approval.");
  if (candidate.entry > candidate.price) reasons.push("The entry is a trigger above current price, not a market buy.");
  if (candidate.liquidityOk) reasons.push("Volume and liquidity look acceptable for a paper-trading watchlist.");
  if (!candidate.extended) reasons.push("Price is not too extended from the nearby support area.");
  if (candidate.dayTradeChecks?.accountFit) reasons.push("The share size and stop risk fit the current paper account.");
  if (candidate.dayTradeChecks?.gapFit) reasons.push("The latest session gap is inside the beginner day-trading limit.");
  if (candidate.targetValidation?.standard.status === "Reachable") reasons.push("The standard target has enough room before major resistance.");
  if (candidate.accountFit?.status === "Good Fit") reasons.push("Fits My Account is marked Good Fit.");
  if (candidate.stopValidation?.status === "Acceptable") reasons.push("The planned stop is not too wide for a small-account day trade.");
  return reasons;
}

function concernReasons(candidate) {
  const concerns = [];
  if (candidate.score < 85) concerns.push("The score is below the beginner approval zone.");
  if (candidate.rr < 2) concerns.push("The risk/reward is below the preferred 2:1 minimum.");
  if (!candidate.liquidityOk) concerns.push("Liquidity may be thin, so spreads could be too wide.");
  if (!candidate.dayTradeChecks?.liquidityFit) concerns.push("Dollar volume is below the preferred day-trading liquidity filter.");
  if (!candidate.dayTradeChecks?.accountFit) concerns.push("The stop distance may be too wide for the current account size.");
  if (!candidate.dayTradeChecks?.gapFit) concerns.push("The latest gap is too large for a beginner day-trading plan.");
  if (candidate.marketWarning) concerns.push(candidate.marketWarning);
  if (candidate.targetValidation?.standard.status === "Low Probability") concerns.push("The standard target is blocked by resistance and has lower probability.");
  if (candidate.targetValidation?.standard.status === "Unrealistic") concerns.push("The standard target is unrealistic based on nearby resistance.");
  if (candidate.stopValidation?.status === "Too Wide") concerns.push(candidate.stopValidation.explanation);
  if (candidate.accountFit?.status === "Poor Fit" || candidate.accountFit?.status === "Does Not Fit") concerns.push(candidate.accountFit.explanation);
  if (candidate.gapCheck?.status === "Gap Too Large") concerns.push(candidate.gapCheck.explanation);
  if (candidate.extended) concerns.push("Price may already be stretched, which increases chase risk.");
  if (candidate.volume < candidate.averageVolume) concerns.push("Volume is below average, so the move may lack confirmation.");
  if (!concerns.length) concerns.push("The main risk is a failed breakout after triggering.");
  return concerns;
}

function beginnerLesson(candidate) {
  if (candidate.setupType === "Momentum Breakout") {
    return "A momentum breakout tries to catch a stock pressing against resistance with stronger-than-usual volume. A beginner waits for price to break and hold above the trigger instead of guessing early.";
  }
  return "A pullback breakout looks for an uptrending stock that cooled off in a controlled way, held support, and is starting to attract buyers again. The trigger helps avoid entering before the stock proves strength.";
}

function targetValidationLesson() {
  return "Many traders choose targets based only on percentages. Professional traders also check whether the chart has enough open space for price to realistically reach the target. A trade with a nice reward-to-risk ratio can still be poor if major resistance blocks the move.";
}
