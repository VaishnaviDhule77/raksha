const Community = require('../models/Community');
const Household = require('../models/Household');
const FoodItem = require('../models/FoodItem');
const Resource = require('../models/Resource');
const SimulationRun = require('../models/SimulationRun');
const ActionPlan = require('../models/ActionPlan');
const SafetyRule = require('../models/SafetyRule');
const { ApiError, asyncHandler } = require('../middleware/errors');
const { runSimulation } = require('../services/simulationEngine');

// GET /api/communities
exports.list = asyncHandler(async (req, res) => {
  res.json(await Community.find().sort('name').lean());
});

// POST /api/communities
exports.create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) throw new ApiError(400, 'Field "name" is required.');
  if (b.population != null && (typeof b.population !== 'number' || b.population < 0)) {
    throw new ApiError(400, '"population" must be a non-negative number.');
  }
  const community = await Community.create(b);
  res.status(201).json(community);
});

// GET /api/communities/:id
exports.getOne = asyncHandler(async (req, res) => {
  const community = await Community.findById(req.params.id).lean();
  if (!community) throw new ApiError(404, 'Community not found.');
  res.json(community);
});

// PUT /api/communities/:id
exports.update = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.name != null && !String(b.name).trim()) throw new ApiError(400, '"name" cannot be empty.');
  const community = await Community.findByIdAndUpdate(req.params.id, b, { new: true, runValidators: true });
  if (!community) throw new ApiError(404, 'Community not found.');
  res.json(community);
});

// DELETE /api/communities/:id — cascades to related records
exports.remove = asyncHandler(async (req, res) => {
  const community = await Community.findByIdAndDelete(req.params.id);
  if (!community) throw new ApiError(404, 'Community not found.');
  const runs = await SimulationRun.find({ communityId: community._id }).select('_id').lean();
  await Promise.all([
    Household.deleteMany({ communityId: community._id }),
    FoodItem.deleteMany({ communityId: community._id }),
    Resource.deleteMany({ communityId: community._id }),
    SimulationRun.deleteMany({ communityId: community._id }),
    ActionPlan.deleteMany({ simulationId: { $in: runs.map(r => r._id) } })
  ]);
  res.json({ ok: true, deleted: community.name });
});

// GET /api/dashboard/summary?communityId=... — frontend compatibility.
// Derives the live gap picture from a quick in-memory 24 h assessment.
exports.dashboardSummary = asyncHandler(async (req, res) => {
  const communityId = req.query.communityId;
  if (!communityId) throw new ApiError(400, 'Query parameter "communityId" is required.');
  const community = await Community.findById(communityId).lean();
  if (!community) throw new ApiError(404, 'Community not found.');

  const [foods, resources, households, rules, lastRunDoc] = await Promise.all([
    FoodItem.find({ communityId }).lean(),
    Resource.find({ communityId }).lean(),
    Household.countDocuments({ communityId }),
    SafetyRule.find({ active: true }).lean(),
    SimulationRun.findOne({ communityId }).sort({ startedAt: -1 }).lean()
  ]);

  const coldTypes = ['Refrigerator', 'Freezer', 'Cold box'];
  const coldKg = resources.filter(r => coldTypes.includes(r.type) && r.unit === 'kg')
    .reduce((s, r) => s + r.capacity, 0);
  const needKg = foods.filter(f => f.storageType !== 'Ambient' ||
    ['Cooked', 'Dairy', 'Vegetables'].includes(f.category))
    .reduce((s, f) => s + f.quantity, 0);
  const atRisk = foods.filter(f => ['CRITICAL', 'PRIORITY'].includes(f.status));
  const atRiskKg = atRisk.reduce((s, f) => s + f.quantity, 0);

  // Quick in-memory assessment of the default 24 h scenario (no DB write)
  const cfg = { disasterType: 'flood+outage', durationHours: 24, internetOff: true, floodExposure: true, ambientTempC: 32 };
  const { baselineResult } = runSimulation({ ...community, households }, cfg, foods, resources, rules);
  const gaps = baselineResult.gaps;
  const highCount = gaps.filter(g => g.severity === 'HIGH').length;
  const firstHigh = gaps.find(g => g.severity === 'HIGH') || gaps[0];

  // Baseline index — storage is derived from data; other components are
  // documented prototype configuration constants.
  const components = [
    { key: 'storage', label: 'Storage capacity', weight: 30, score: Math.min(100, Math.round((coldKg / Math.max(1, needKg)) * 100)) },
    { key: 'power', label: 'Backup power', weight: 20, score: resources.some(r => r.type === 'Generator') ? 40 : 10 },
    { key: 'stock', label: 'Emergency food stock', weight: 15, score: 45 },
    { key: 'coverage', label: 'Resource coverage', weight: 15, score: 70 },
    { key: 'offline', label: 'Offline preparedness', weight: 10, score: 60 },
    { key: 'safety', label: 'Safety & contamination plan', weight: 10, score: 60 }
  ];
  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight / 100, 0));
  const band = score >= 75 ? 'Strong' : score >= 50 ? 'Moderate' : 'Weak';

  const lastRun = lastRunDoc ? {
    runId: String(lastRunDoc._id),
    label: lastRunDoc.result && lastRunDoc.result.scenario ? lastRunDoc.result.scenario.label : 'Simulation',
    createdAt: lastRunDoc.startedAt,
    capacityGapKg: lastRunDoc.resultMetrics ? lastRunDoc.resultMetrics.gapKg : null,
    optimized: !!lastRunDoc.optimized
  } : null;

  res.json({
    community: {
      _id: String(community._id), name: community.name, households,
      region: community.region || '', coordinator: community.coordinatorId || ''
    },
    index: { score, band, components, disclaimer: 'Prototype preparedness index; not a validated disaster-risk score.' },
    storage: { nominalColdKg: coldKg, needColdKg: needKg, note: 'Grid power assumed ON — run the simulator for outage scenarios.' },
    foodAtRisk: { kg: atRiskKg, items: atRisk.length },
    criticalGaps: {
      count: gaps.length, high: highCount,
      top: firstHigh ? firstHigh.title : 'No gaps detected',
      list: gaps
    },
    resources: {
      count: resources.length,
      coldUnits: resources.filter(r => coldTypes.includes(r.type)).length,
      coldChainKg: coldKg,
      generators: resources.filter(r => r.type === 'Generator').length,
      iceKg: (resources.find(r => r.type === 'Ice supply') || {}).capacity || 0
    },
    lastRun,
    food: foods.map(f => ({ ...f, id: String(f._id) })),
    resourceList: resources.map(r => ({ ...r, id: String(r._id) }))
  });
});