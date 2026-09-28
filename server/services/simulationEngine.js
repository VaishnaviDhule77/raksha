/**
 * RAKSHA — Simulation Engine (orchestrator)
 * -----------------------------------------
 * Pure function — no database access. Pipeline (steps 6–16 of the spec):
 *   apply disaster conditions -> evaluate food safety -> determine food
 *   requiring protection -> required/eligible capacity -> capacity gap ->
 *   unprotected & critical food -> optimize allocation -> preparedness gaps
 *   -> recommendations (P0/P1/P2) -> prototype preparedness index.
 *
 * Returns BOTH strategies:
 *   baselineResult  — "as stored today" placement (what the community does now)
 *   optimizedResult — ranked, protection-aware placement
 *
 * Each result carries the canonical fields required by the specification AND
 * legacy aliases (totals / allocation / foodStatus / gaps / actions /
 * preparedness) so the existing frontend renders unchanged.
 */

const safety = require('./foodSafetyEngine');
const capacity = require('./capacityEngine');
const matcher = require('./resourceMatcher');

const SEV_ORDER = { UNSAFE: 0, CRITICAL: 0, PRIORITY: 1, PROTECT: 2, STABLE: 3 };
const LABELS = { flood: 'Flood', outage: 'Power outage', 'flood+outage': 'Flood + power outage' };
const INDEX_DISCLAIMER = 'Prototype preparedness index; not a validated disaster-risk score.';

// Documented prototype configuration constants for index components that are
// not yet derivable from data (replace with community-configured values).
const INDEX_CONSTANTS = { STOCK_SCORE: 45, COVERAGE_SCORE: 70, OFFLINE_SCORE: 60, POWER_WITH_GENERATOR: 40, POWER_WITHOUT: 10 };

function cleanRule(r) {
  return {
    ruleCode: r.ruleCode, condition: r.condition, action: r.action, priority: r.priority,
    explanation: r.explanation, sourceOrganization: r.sourceOrganization,
    sourceUrl: r.sourceUrl, jurisdiction: r.jurisdiction, lastVerified: r.lastVerified
  };
}

function cleanResource(r) {
  return {
    id: String(r._id), name: r.name, type: r.type, capacity: r.capacity, unit: r.unit,
    location: r.location || '', powerSource: r.powerSource,
    operationalStatus: r.operationalStatus || (r.operational ? 'Operational' : 'Non-functional'),
    availability: r.availability || 'Available', ownerType: r.ownerType || 'Community',
    poweredByGenerator: !!r.poweredByGenerator
  };
}

/* ---------------- preparedness gaps ---------------- */

function buildGaps(cap, strategySum, scenario, unsafeCount) {
  const gaps = [];

  // Structural capacity gap (spec formula): required - eligible protected capacity
  if (cap.capacityGap > 0) {
    gaps.push({
      code: 'GAP-CAP-01', severity: 'HIGH', title: 'Cold-chain capacity shortfall',
      detail: `${cap.capacityGap} kg of food requiring protection cannot be protected even with optimal allocation ` +
        `(required ${cap.requiredCapacity} kg vs eligible protected capacity ${cap.protectedCapacity} kg). ` +
        `Current placement leaves ${Math.max(0, cap.requiredCapacity - strategySum.protectedKg)} kg unprotected.`
    });
  }
  if (scenario.powerOff && cap.hasGenerator) {
    gaps.push({
      code: 'GAP-PWR-01', severity: 'HIGH', title: 'Generator fuel coverage',
      detail: `Fuel on hand supports roughly 8 h of the ${scenario.durationHours} h outage (prototype assumption) — arrange rotation or load-shedding.`
    });
  }
  if (scenario.powerOff && cap.iceKg > 0 && cap.iceKg < 40) {
    gaps.push({
      code: 'GAP-ICE-01', severity: 'MEDIUM', title: 'Ice reserve insufficient',
      detail: `${cap.iceKg} kg of ice covers only the cold box; there is no reserve for additional containers.`
    });
  }
  if (scenario.floodExposure) {
    gaps.push({
      code: 'GAP-FLD-01', severity: 'MEDIUM', title: 'Flood-line relocation plan incomplete',
      detail: 'No configured elevation plan for ambient stores (grains, canned goods) in the flood zone.'
    });
  }
  if (unsafeCount > 0) {
    gaps.push({
      code: 'GAP-CONTAM-01', severity: 'HIGH', title: 'Flood-contaminated food present',
      detail: `${unsafeCount} food item(s) have contacted flood water and must be separated from all other stores per the configured contamination rule.`
    });
  }
  if (scenario.internetOff) {
    gaps.push({
      code: 'GAP-COM-01', severity: 'LOW', title: 'Offline communication plan',
      detail: 'Printed plan copies not confirmed at all shelters; internet is assumed unavailable during the event.'
    });
  }
  return gaps;
}

/* ---------------- recommendations (P0 / P1 / P2) ---------------- */

function ruleCitation(rule) {
  if (!rule) return null;
  return {
    ruleCode: rule.ruleCode,
    sourceOrganization: rule.sourceOrganization || '',
    sourceUrl: rule.sourceUrl || '',
    jurisdiction: rule.jurisdiction || '',
    explanation: rule.explanation || ''
  };
}

function buildRecommendations(which, baseline, baselineSum, optimizedSum, cap, scenario, rules, foodStatus) {
  const recs = [];
  const byCode = new Map(rules.map(r => [r.ruleCode, r]));
  const criticalUnprotected = baseline.state
    .filter(u => !u.supported)
    .flatMap(u => u.items.filter(i => {
      const f = foodStatus.find(x => x.name === i.food);
      return f && f.status === 'CRITICAL';
    }));
  const unsafeItems = foodStatus.filter(f => f.status === 'UNSAFE');

  // P0 — Immediate
  if (unsafeItems.length) {
    recs.push({
      tier: 'P0', category: 'contamination',
      title: 'Separate flood-exposed food immediately',
      detail: `Set apart and do not consume: ${unsafeItems.map(f => f.name).join(', ')}. Keep it away from all other stores and water sources.`,
      time: 'Immediate',
      rule: ruleCitation(byCode.get('FS-FLOOD-01'))
    });
  }
  if (criticalUnprotected.length) {
    const names = [...new Set(criticalUnprotected.map(i => i.food))];
    recs.push({
      tier: 'P0', category: 'relocation',
      title: 'Protect priority perishables — move critical food off the unpowered circuit',
      detail: `Move ${names.join(', ')} into generator-backed or iced storage now.`,
      time: 'Immediate',
      rule: ruleCitation(byCode.get('FS-REFR-02'))
    });
  }

  // P1 — High
  if (which === 'baseline' && optimizedSum.protectedKg > baselineSum.protectedKg) {
    recs.push({
      tier: 'P1', category: 'optimization',
      title: 'Run resource optimization',
      detail: `Reallocating to generator-backed and iced storage can protect up to ${optimizedSum.protectedKg - baselineSum.protectedKg} kg more food (${optimizedSum.protectedKg} kg of ${cap.requiredCapacity} kg protected).`,
      time: 'Before the event / immediately', rule: null
    });
  }
  if (scenario.powerOff && cap.hasGenerator) {
    recs.push({
      tier: 'P1', category: 'power',
      title: 'Activate generator for designated refrigeration',
      detail: `Connect the generator circuit to its designated cold-chain appliances and plan fuel rotation for the ${scenario.durationHours} h outage.`,
      time: 'First hour', rule: ruleCitation(byCode.get('FS-GEN-01'))
    });
  }
  if (cap.capacityGap > 0 || (cap.requiredCapacity - (which === 'optimized' ? optimizedSum : baselineSum).protectedKg) > 0) {
    recs.push({
      tier: 'P1', category: 'cold-chain',
      title: 'Move eligible food to available cold storage',
      detail: `Place all protection-required food into operational, scenario-compatible storage; keep doors and lids closed.`,
      time: 'First hour', rule: ruleCitation(byCode.get('FS-FRZ-01'))
    });
  }

  // P2 — Medium
  if (which === 'optimized') {
    recs.push({
      tier: 'P2', category: 'reallocation',
      title: 'Reallocation applied',
      detail: `Perishables moved into protected units (${optimizedSum.protectedKg} kg protected, ${Math.max(0, cap.requiredCapacity - optimizedSum.protectedKg)} kg gap remaining).`,
      time: 'Immediate', rule: null
    });
  }
  if (scenario.powerOff && cap.iceKg > 0) {
    recs.push({
      tier: 'P2', category: 'cold-chain',
      title: 'Load ice into the cold box',
      detail: `Distribute the ${cap.iceKg} kg ice stock to the cold box and keep lids closed.`,
      time: 'First hour', rule: ruleCitation(byCode.get('FS-FRZ-01'))
    });
  }
  recs.push({
    tier: 'P2', category: 'consumption',
    title: 'Use shelf-stable food first, per configured guidance',
    detail: 'Plan meals around stable stock first; treat cooked food as consume-first and never taste-test questionable perishables.',
    time: 'Ongoing', rule: ruleCitation(byCode.get('FS-REFR-02'))
  });
  if (cap.capacityGap > 0) {
    recs.push({
      tier: 'P2', category: 'capacity',
      title: 'Address the storage capacity gap — prepare additional cold storage',
      detail: `${cap.capacityGap} kg cannot be protected even with optimal allocation. Arrange additional iced containers, cold boxes or generator capacity.`,
      time: 'Before the event', rule: null
    });
  }
  if (scenario.floodExposure) {
    recs.push({
      tier: 'P2', category: 'flood',
      title: 'Move ambient stores above the flood line',
      detail: 'Relocate grains and canned stock to elevated shelving; discard any food touched by flood water.',
      time: 'Before flooding', rule: ruleCitation(byCode.get('FS-FLOOD-01'))
    });
  }
  if (scenario.internetOff) {
    recs.push({
      tier: 'P2', category: 'communication',
      title: 'Print and cache the emergency plan',
      detail: 'Post printed copies at the community hall and shelters, and save the offline copy on coordinator devices.',
      time: 'Before the event', rule: null
    });
  }
  recs.push({
    tier: 'P2', category: 'monitoring',
    title: 'Verify appliance thermometers',
    detail: 'Check fridge/freezer thermometers and keep doors closed as long as possible.',
    time: 'Ongoing', rule: null
  });
  return recs;
}

/* ---------------- preparedness index ---------------- */

function buildPreparednessScore(strategyProtectedKg, cap, scenario) {
  const storageScore = Math.min(100, Math.round((strategyProtectedKg / Math.max(1, cap.requiredCapacity)) * 100));
  const components = [
    { key: 'storage', label: 'Storage capacity', weight: 30, score: storageScore },          // protected vs required under this strategy
    { key: 'power', label: 'Backup power', weight: 20, score: cap.hasGenerator ? INDEX_CONSTANTS.POWER_WITH_GENERATOR : INDEX_CONSTANTS.POWER_WITHOUT },
    { key: 'stock', label: 'Emergency food stock', weight: 15, score: INDEX_CONSTANTS.STOCK_SCORE },
    { key: 'coverage', label: 'Resource coverage', weight: 15, score: INDEX_CONSTANTS.COVERAGE_SCORE },
    { key: 'offline', label: 'Offline preparedness', weight: 10, score: INDEX_CONSTANTS.OFFLINE_SCORE },
    { key: 'safety', label: 'Safety & contamination plan', weight: 10, score: scenario.floodExposure ? 55 : 65 }
  ];
  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight / 100, 0));
  const band = score >= 75 ? 'Strong' : score >= 50 ? 'Moderate' : 'Weak';
  return { score, band, components, disclaimer: INDEX_DISCLAIMER };
}

/* ---------------- main entry point ---------------- */

function runSimulation(community, cfg, foods, resources, rules) {
  // Step 6 — apply disaster conditions
  const powerOff = cfg.disasterType !== 'flood';
  const flood = cfg.disasterType !== 'outage' && !!cfg.floodExposure;
  const ctx = {
    flood, powerOff,
    hasGenerator: resources.some(r => r.type === 'Generator' && r.operational)
  };
  const scenario = {
    label: `${LABELS[cfg.disasterType]} · ${cfg.durationHours} h`,
    disasterType: cfg.disasterType, durationHours: cfg.durationHours,
    powerOff, internetOff: !!cfg.internetOff,
    floodExposure: flood, ambientTempC: cfg.ambientTempC
  };

  // Step 7 — evaluate food safety (rule-driven classification + guidance)
  const foodEvaluated = safety.assessFood(foods, scenario, ctx, rules);

  // Step 8 — determine food requiring protection (UNSAFE food excluded: it is
  // separated/discarded, never stored)
  const queue = foodEvaluated
    .filter(f => f.allocatedToStorage)
    .sort((a, b) => (SEV_ORDER[a.status] - SEV_ORDER[b.status]) || (b.quantity - a.quantity));

  // Steps 9–11 — capacity picture (required / eligible protected / gap)
  const support = capacity.assessSupport(resources, scenario);
  const cap = capacity.computeCapacities(support.units, queue);
  cap.hasGenerator = support.hasGenerator;   // ← FIX: merge support flags so gaps,
  cap.iceKg = support.iceKg;                 // ← FIX: recommendations & index see them

  // Step 12–13 — baseline ("as stored") and optimized allocations
  const baseline = matcher.baselineAllocation(queue, support.units);
  const optimized = matcher.optimizedAllocation(queue, support.units);
  const baselineSum = matcher.summarize(baseline.state, baseline.unplaced);
  const optimizedSum = matcher.summarize(optimized.state, optimized.unplaced);

  const applied = rules.filter(r => safety.ruleTriggerMatches(r, ctx));
  const critical = foodEvaluated.filter(f => f.status === 'CRITICAL');
  const priority = foodEvaluated.filter(f => f.status === 'PRIORITY');
  const unsafeItems = foodEvaluated.filter(f => f.status === 'UNSAFE');
  const totalKg = foodEvaluated.reduce((s, f) => s + f.quantity, 0);

  const communitySnap = {
    id: String(community._id), name: community.name,
    households: community.households || 0,
    region: community.region || '', coordinator: community.coordinatorId || ''
  };
  const resourceSnaps = resources.map(cleanResource);

  const buildResult = (which) => {
    const alloc = which === 'optimized' ? optimized : baseline;
    const sum = which === 'optimized' ? optimizedSum : baselineSum;
    const allocations = matcher.allocationTable(alloc.state, alloc.unplaced, sum);
    const strategyProtectedKg = sum.protectedKg;
    const strategyGapKg = Math.max(0, cap.requiredCapacity - strategyProtectedKg);

    const recommendations = buildRecommendations(which, baseline, baselineSum, optimizedSum, cap, scenario, rules, foodEvaluated);
    const preparednessGaps = buildGaps(cap, sum, scenario, unsafeItems.length);
    const preparednessScore = buildPreparednessScore(strategyProtectedKg, cap, scenario);

    return {
      // ── canonical result (specification) ──
      scenario,
      foodEvaluated,
      criticalFood: critical.map(f => ({ name: f.name, quantity: f.quantity, unit: f.unit, category: f.category, guidance: f.guidance })),
      priorityFood: priority.map(f => ({ name: f.name, quantity: f.quantity, unit: f.unit, category: f.category, guidance: f.guidance })),
      unsafeFood: unsafeItems.map(f => ({ name: f.name, quantity: f.quantity, unit: f.unit, guidance: f.guidance })),
      protectedFood: sum.protectedFood,
      unprotectedFood: sum.unprotectedFood,
      requiredCapacity: cap.requiredCapacity,
      protectedCapacity: cap.protectedCapacity,
      capacityGap: cap.capacityGap,
      resourceUtilization: allocations.map(a => ({
        resourceId: a.resourceId, resource: a.resource, type: a.type,
        capacityKg: a.capacityKg, allocatedKg: a.allocatedKg,
        utilizationPercent: a.utilization, protected: a.protected, poweredBy: a.poweredBy
      })),
      allocations,
      preparednessGaps,
      recommendations,
      preparednessScore,
      appliedRules: applied.map(cleanRule),

      // ── legacy aliases (existing frontend contract) ──
      community: communitySnap,
      resources: resourceSnaps,
      support: support.support,
      totals: {
        totalKg, needKg: cap.requiredCapacity,
        protectedKg: strategyProtectedKg, gapKg: strategyGapKg,
        criticalKg: critical.reduce((s, f) => s + f.quantity, 0), criticalCount: critical.length,
        unprotectedKg: sum.unprotectedPlacedKg + sum.unplacedKg
      },
      allocation: allocations,
      foodStatus: foodEvaluated,
      gaps: preparednessGaps,
      actions: recommendations,
      rulesApplied: applied.map(cleanRule),
      preparedness: preparednessScore
    };
  };

  const baselineResult = buildResult('baseline');
  const optimizedResult = buildResult('optimized');
  return {
    baselineResult,
    optimizedResult,
    baselineMetrics: { ...baselineResult.totals },
    optimizedMetrics: { ...optimizedResult.totals }
  };
}

module.exports = { runSimulation, INDEX_DISCLAIMER };