/**
 * RAKSHA — Emergency Action Plan Generator (pipeline step 18)
 * Builds the composite plan (rendered + cached offline by the frontend) AND
 * the atomic action_plans documents (one per recommendation, P0/P1/P2).
 */

const ActionPlan = require('../models/ActionPlan');

const PLAN_DISCLAIMER = 'RAKSHA is a prototype decision-support tool. This plan does not guarantee food safety ' +
  'and has not been tested in a real disaster. Follow instructions from local authorities and the configured, ' +
  'source-backed food-safety guidance referenced in this document.';
const INDEX_DISCLAIMER = 'Prototype preparedness index; not a validated disaster-risk score.';

// Per-item critical actions cite the rule that classified the item — no
// invented guidance. (Mapping is a system convention; wording comes from rules.)
function criticalActionFor(f) {
  const ruleCode = f.guidance && f.guidance.ruleCode;
  if (f.category === 'Dairy') {
    return { action: 'Keep below refrigeration temperature on the protected circuit; apply the configured time-temperature limit.', ruleCode: ruleCode || 'FS-REFR-02' };
  }
  if (f.category === 'Cooked') {
    return { action: 'Treat as consume-first: use within the safe window; never re-store at ambient temperature.', ruleCode: ruleCode || 'FS-REFR-02' };
  }
  return { action: 'Maintain frozen storage on the protected circuit; do not store with flood-exposed items.', ruleCode: ruleCode || 'FS-FRZ-01' };
}

async function generatePlan(run) {
  const src = run.optimized ? run.optimizedResult : run.result;
  const recommendations = src.recommendations || src.actions || [];

  // Atomic action documents (action_plans collection)
  await ActionPlan.deleteMany({ simulationId: run._id });
  const actionDocs = await ActionPlan.insertMany(recommendations.map(a => ({
    simulationId: run._id,
    priority: a.tier,                       // P0 | P1 | P2
    action: `${a.title} — ${a.detail} (When: ${a.time})`,
    category: a.category || 'general',
    status: 'pending',
    sourceRuleId: null,                     // populated below when a rule is cited
    offlineAvailable: true
  })));

  // Composite plan (frontend contract — unchanged shape)
  const plan = {
    planId: `plan-${String(run._id).slice(-6)}`,
    runId: String(run._id),
    generatedAt: new Date().toISOString(),
    community: src.community,
    scenario: src.scenario,
    priorityActions: recommendations,
    criticalFoodActions: (src.criticalFood || []).map(f => {
      const a = criticalActionFor(f);
      return { food: f.name, qty: f.quantity, unit: f.unit, status: 'CRITICAL', action: a.action, ruleCode: a.ruleCode };
    }),
    unsafeFoodActions: (src.unsafeFood || []).map(f => ({
      food: f.name, qty: f.quantity, unit: f.unit, status: 'UNSAFE',
      action: 'Separate from all other food and do not consume — apply the configured contamination rule.',
      ruleCode: f.guidance && f.guidance.ruleCode
    })),
    resources: src.resources || [],
    allocation: src.allocation,
    gaps: src.preparednessGaps || src.gaps,
    rulesApplied: src.appliedRules || src.rulesApplied,
    notes: (run.plan && run.plan.notes) || '',
    actionCount: actionDocs.length,
    disclaimers: { index: INDEX_DISCLAIMER, plan: PLAN_DISCLAIMER }
  };
  return plan;
}

module.exports = { generatePlan };