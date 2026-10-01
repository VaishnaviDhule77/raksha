const SimulationRun = require('../models/SimulationRun');
const Community = require('../models/Community');
const Household = require('../models/Household');
const FoodItem = require('../models/FoodItem');
const Resource = require('../models/Resource');
const SafetyRule = require('../models/SafetyRule');
const DisasterScenario = require('../models/DisasterScenario');
const { ApiError, asyncHandler } = require('../middleware/errors');
const { runSimulation } = require('../services/simulationEngine');
const { generatePlan } = require('../services/actionPlanGenerator');

const DISASTER_TYPES = ['flood', 'outage', 'flood+outage'];

function validateCfg(cfg) {
  if (!DISASTER_TYPES.includes(cfg.disasterType)) {
    throw new ApiError(400, '"config.disasterType" must be flood, outage or flood+outage.');
  }
  if (!Number.isFinite(cfg.durationHours) || cfg.durationHours < 1 || cfg.durationHours > 336) {
    throw new ApiError(400, '"config.durationHours" must be a number between 1 and 336.');
  }
  if (!Number.isFinite(cfg.ambientTempC) || cfg.ambientTempC < -10 || cfg.ambientTempC > 60) {
    throw new ApiError(400, '"config.ambientTempC" must be a number between -10 and 60.');
  }
}

// Shapes a run document into the API response: canonical engine fields plus
// the legacy aliases the existing frontend renders.
function presentRun(run) {
  const src = run.optimized ? run.optimizedResult : run.result;
  if (!src || !src.totals) throw new ApiError(500, 'Run result is missing — re-run the simulation.');
  return {
    runId: String(run._id),
    createdAt: run.startedAt,
    scenarioId: run.scenarioId ? String(run.scenarioId) : null,

    // canonical (engine specification)
    scenario: src.scenario,
    foodEvaluated: src.foodEvaluated,
    criticalFood: src.criticalFood,
    priorityFood: src.priorityFood,
    unsafeFood: src.unsafeFood,
    protectedFood: src.protectedFood,
    unprotectedFood: src.unprotectedFood,
    requiredCapacity: src.requiredCapacity,
    protectedCapacity: src.protectedCapacity,
    capacityGap: src.capacityGap,
    resourceUtilization: src.resourceUtilization,
    allocations: src.allocations,
    preparednessGaps: src.preparednessGaps,
    recommendations: src.recommendations,
    preparednessScore: src.preparednessScore,
    appliedRules: src.appliedRules,

    // legacy (frontend contract)
    community: src.community,
    totals: src.totals,
    initialTotals: run.optimized ? run.baselineMetrics : null,
    baselineMetrics: run.baselineMetrics,
    foodStatus: src.foodStatus,
    allocation: src.allocation,
    support: src.support,
    gaps: src.gaps,
    actions: src.actions,
    rulesApplied: src.rulesApplied,
    preparedness: src.preparedness,
    optimized: run.optimized
  };
}

// Helper to resolve communityDoc with automatic fallback for missing/dummy IDs
async function resolveCommunity(communityId) {
  let communityDoc = null;
  if (communityId) {
    communityDoc = await Community.findById(communityId);
  }
  if (!communityDoc) {
    communityDoc = await Community.findOne().sort({ createdAt: 1 });
  }
  if (!communityDoc) {
    throw new ApiError(404, 'No community document found in database. Please seed default data.');
  }
  return communityDoc;
}

// POST /api/simulations/run — pipeline steps 1–5 + 6–16 + 17 (save)
exports.run = asyncHandler(async (req, res) => {
  const b = req.body || {};

  // Step 1: Load community with fallback resolution
  const communityDoc = await resolveCommunity(b.communityId);

  let cfg, scenarioId = null;
  if (b.scenarioId) {
    const scenario = await DisasterScenario.findById(b.scenarioId);
    if (!scenario) throw new ApiError(404, `Scenario not found: ${b.scenarioId}`);
    scenarioId = scenario._id;
    cfg = {
      disasterType: scenario.disasterType,
      durationHours: scenario.durationHours,
      internetOff: !scenario.internetAvailable,
      floodExposure: scenario.floodExposure,
      ambientTempC: scenario.ambientTemperature
    };
  } else if (b.config) {
    cfg = {
      disasterType: b.config.disasterType,
      durationHours: Number(b.config.durationHours),
      internetOff: !!b.config.internetOff,
      floodExposure: !!b.config.floodExposure,
      ambientTempC: Number(b.config.ambientTempC)
    };
  } else {
    throw new ApiError(400, 'Provide either "scenarioId" or "config" { disasterType, durationHours, internetOff, floodExposure, ambientTempC }.');
  }
  validateCfg(cfg);

  const [foods, resources, rules, households] = await Promise.all([
    FoodItem.find({ communityId: communityDoc._id }).lean(),   // step 2
    Resource.find({ communityId: communityDoc._id }).lean(),   // step 3
    SafetyRule.find({ active: true }).lean(),                  // step 5
    Household.countDocuments({ communityId: communityDoc._id })
  ]);

  // Steps 6–16: run the engine (pure function)
  const engine = runSimulation({ ...communityDoc.toObject(), households }, cfg, foods, resources, rules);

  // Step 17: save the simulation
  const run = await SimulationRun.create({
    communityId: communityDoc._id,
    scenarioId,
    config: cfg,
    baselineMetrics: engine.baselineMetrics,
    resultMetrics: engine.baselineMetrics,
    optimizedMetrics: engine.optimizedMetrics,
    preparednessScore: engine.baselineResult.preparednessScore,
    gaps: engine.baselineResult.preparednessGaps,
    recommendations: engine.baselineResult.recommendations,
    result: engine.baselineResult,
    optimizedResult: engine.optimizedResult,
    optimized: false
  });

  res.status(201).json(presentRun(run));
});

// GET /api/simulations?communityId=
exports.list = asyncHandler(async (req, res) => {
  let filter = {};
  if (req.query.communityId) {
    const communityDoc = await resolveCommunity(req.query.communityId);
    filter = { communityId: communityDoc._id };
  }
  const runs = await SimulationRun.find(filter).sort({ startedAt: -1 }).limit(20).lean();
  res.json(runs.map(r => ({
    runId: String(r._id),
    communityId: String(r.communityId),
    scenarioId: r.scenarioId ? String(r.scenarioId) : null,
    startedAt: r.startedAt,
    optimized: r.optimized,
    label: r.result && r.result.scenario ? r.result.scenario.label : 'Simulation',
    gapKg: r.resultMetrics ? r.resultMetrics.gapKg : null
  })));
});

// GET /api/simulations/latest?communityId=
exports.latest = asyncHandler(async (req, res) => {
  let filter = {};
  if (req.query.communityId) {
    const communityDoc = await resolveCommunity(req.query.communityId);
    filter = { communityId: communityDoc._id };
  }
  const run = await SimulationRun.findOne(filter).sort({ startedAt: -1 });
  if (!run) return res.json(null);
  res.json(presentRun(run));
});

// GET /api/simulations/:id
exports.getOne = asyncHandler(async (req, res) => {
  const run = await SimulationRun.findById(req.params.id);
  if (!run) throw new ApiError(404, 'Simulation not found.');
  res.json(presentRun(run));
});

// POST /api/simulations/:id/optimize
exports.optimize = asyncHandler(async (req, res) => {
  const run = await SimulationRun.findById(req.params.id);
  if (!run) throw new ApiError(404, 'Simulation not found.');
  if (!run.optimized) {
    run.optimized = true;
    run.optimizedAt = new Date();
    run.resultMetrics = run.optimizedMetrics;
    run.gaps = run.optimizedResult.preparednessGaps;
    run.recommendations = run.optimizedResult.recommendations;
    run.preparednessScore = run.optimizedResult.preparednessScore;
    run.markModified('resultMetrics');
    await run.save();
  }
  res.json(presentRun(run));
});

// POST /api/simulations/:id/plan — pipeline step 18
exports.generatePlan = asyncHandler(async (req, res) => {
  const run = await SimulationRun.findById(req.params.id);
  if (!run) throw new ApiError(404, 'Simulation not found.');
  const plan = await generatePlan(run);
  run.plan = plan;
  run.markModified('plan');
  await run.save();
  res.status(201).json(plan);
});