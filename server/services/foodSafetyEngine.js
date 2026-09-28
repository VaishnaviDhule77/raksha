/**
 * RAKSHA — Food Safety Rule Engine
 * --------------------------------
 * Classifies every food item under a disaster scenario and produces guidance,
 * using ONLY configured safety rules. RAKSHA invents no food-safety
 * thresholds: triage status comes from each rule's own `priority` field, and
 * every guidance entry retains the rule's source metadata.
 *
 * Classification order (per specification):
 *   1. scenario.floodExposure && item.floodExposure -> the configured
 *      CONTAMINATION rule decides (Critical-priority rule -> UNSAFE, else CRITICAL)
 *   2. a configured non-contamination rule that targets this food and matches
 *      the scenario -> status mapped from the rule's `priority`
 *   3. documented default prioritisation ladder (system convention, no safety
 *      claims): perishable/cooked -> PRIORITY, frozen -> PROTECT,
 *      shelf-stable -> STABLE, fresh produce -> PROTECT
 *
 * Contamination rules (trigger.floodExposure === true) NEVER classify food
 * that has not contacted flood water — they decide only exposed items.
 */

const PRIO_OF = { CRITICAL: 'Critical', PRIORITY: 'High', PROTECT: 'Medium', STABLE: 'Low', UNSAFE: 'Critical' };

// System conventions (NOT safety thresholds): map the CONFIGURED rule's own
// priority field to a triage status.
const STATUS_FROM_RULE_PRIORITY = { Critical: 'CRITICAL', High: 'PRIORITY', Medium: 'PROTECT', Low: 'STABLE' };
const CONTAMINATION_STATUS_FROM_RULE_PRIORITY = { Critical: 'UNSAFE', High: 'CRITICAL', Medium: 'CRITICAL', Low: 'CRITICAL' };

const FRESH_PRODUCE = ['Vegetables', 'Fruits'];
const PERISHABLE_CATEGORIES = ['Cooked', 'Dairy', 'Meat'];

/* ---------------- rule matching ---------------- */

function isContaminationRule(rule) {
  return (rule.trigger || {}).floodExposure === true;
}

function ruleTriggerMatches(rule, ctx) {
  const t = rule.trigger || {};
  if (t.floodExposure && !ctx.flood) return false;
  if (t.powerOutage && !ctx.powerOff) return false;
  if (t.generatorPresent && !ctx.hasGenerator) return false;
  return true;
}

// Step-2 targeting. Contamination rules are excluded: they classify ONLY
// flood-exposed items (handled in step 1), never the general inventory.
function ruleTargetsFood(rule, item) {
  if (isContaminationRule(rule)) return false;
  const a = rule.appliesTo;
  if (!a) return false; // scenario-level practice rule — never classifies food
  const cats = a.categories || [];
  const stor = a.storageTypes || [];
  return cats.includes(item.category) || stor.includes(item.storageType);
}

/* ---------------- classification ---------------- */

function classifyFood(item, scenario, ctx, rules) {
  // 1) Item-level flood contamination — the configured contamination rule decides
  if (scenario.floodExposure && item.floodExposure) {
    const contam = rules.find(r => isContaminationRule(r) && ruleTriggerMatches(r, ctx));
    if (contam) {
      return {
        status: CONTAMINATION_STATUS_FROM_RULE_PRIORITY[contam.priority] || 'CRITICAL',
        rule: contam
      };
    }
    return { status: 'CRITICAL', rule: null }; // exposed, but no contamination rule configured
  }

  // 2) Configured non-contamination rule targeting this food under this scenario
  const targeted = rules.find(r => ruleTargetsFood(r, item) && ruleTriggerMatches(r, ctx));
  if (targeted) {
    return { status: STATUS_FROM_RULE_PRIORITY[targeted.priority] || 'PROTECT', rule: targeted };
  }

  // 3) Documented default ladder (system convention; rule-overridable)
  if (item.storageType === 'Refrigerated' || PERISHABLE_CATEGORIES.includes(item.category)) {
    return { status: 'PRIORITY', rule: null };
  }
  if (item.storageType === 'Frozen') return { status: 'PROTECT', rule: null };
  if (FRESH_PRODUCE.includes(item.category)) return { status: 'PROTECT', rule: null };
  return { status: 'STABLE', rule: null };
}

/* ---------------- protection requirement ---------------- */

// Does this item need a PROTECTED (cold/iced/powered) storage slot under the
// scenario? Rule-driven: refrigerated/frozen always; fresh produce only when
// a configured flood-contamination rule is active (flood scenario).
function requiresProtection(item, scenario, ctx, rules) {
  if (item.storageType === 'Refrigerated' || item.storageType === 'Frozen') return true;
  if (FRESH_PRODUCE.includes(item.category) && scenario.floodExposure) {
    return rules.some(r => isContaminationRule(r) && ruleTriggerMatches(r, ctx));
  }
  return false;
}

/* ---------------- guidance text ----------------
   System templates that CITE the configured rule. No invented thresholds,
   timings or claims — the authoritative wording is the rule's own action. */

function guidanceFor(item, status, rule, scenario) {
  const cited = rule ? ` Configured guidance (${rule.ruleCode}): ${rule.action}` : '';
  switch (status) {
    case 'UNSAFE':
      return `Do not consume and do not store with other food — separate this item. Configured contamination guidance (${rule ? rule.ruleCode : 'no rule configured'}): ${rule ? rule.action : 'discard food that has contacted flood water.'}`;
    case 'CRITICAL':
      return `Requires protected cold storage under this scenario.${cited}`;
    case 'PRIORITY':
      return `Cold chain required — allocate to powered or iced storage and keep doors closed.${cited}`;
    case 'PROTECT':
      if (FRESH_PRODUCE.includes(item.category) && scenario.floodExposure) {
        return `Keep dry and above the expected flood line; discard any food that contacts flood water.${cited}`;
      }
      if (item.storageType === 'Frozen') {
        return `Maintain frozen storage for this item.${cited}`;
      }
      return `Keep dry, shaded and above the expected flood line where flooding is possible.${cited}`;
    default:
      return `Shelf-stable — protect packaging from flood water where flooding is possible.${cited}`;
  }
}

/* ---------------- public API ---------------- */

// Evaluates every food item. Each guidance entry retains ruleCode /
// sourceOrganization / sourceUrl / jurisdiction / explanation.
function assessFood(foods, scenario, ctx, rules) {
  return foods.map(item => {
    const { status, rule } = classifyFood(item, scenario, ctx, rules);
    const protection = requiresProtection(item, scenario, ctx, rules);

    // Fresh produce under flood keeps its default-ladder PROTECT status, but
    // its GUIDANCE cites the active contamination rule (source metadata).
    let citedRule = rule;
    if (!citedRule && FRESH_PRODUCE.includes(item.category) && scenario.floodExposure) {
      citedRule = rules.find(r => isContaminationRule(r) && ruleTriggerMatches(r, ctx)) || null;
    }

    // UNSAFE food is never allocated to storage — it must be separated/discarded.
    const inQueue = protection && status !== 'UNSAFE';
    const text = guidanceFor(item, status, citedRule, scenario);
    return {
      id: String(item._id),
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      storageType: item.storageType,
      cooked: !!item.cooked,
      sealed: !!item.sealed,
      floodExposure: !!item.floodExposure,
      status,
      priority: PRIO_OF[status],
      requiresProtection: protection,
      allocatedToStorage: inQueue,
      guidance: {
        text,
        ruleCode: citedRule ? citedRule.ruleCode : null,
        sourceOrganization: citedRule ? citedRule.sourceOrganization || '' : '',
        sourceUrl: citedRule ? citedRule.sourceUrl || '' : '',
        jurisdiction: citedRule ? citedRule.jurisdiction || '' : '',
        explanation: citedRule ? citedRule.explanation || '' : ''
      },
      note: text // legacy field used by the existing frontend
    };
  });
}

module.exports = {
  assessFood,
  classifyFood,
  requiresProtection,
  ruleTriggerMatches,
  ruleTargetsFood,
  isContaminationRule,
  PRIO_OF,
  FRESH_PRODUCE
};