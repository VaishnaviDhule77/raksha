const SyncQueue = require('../models/SyncQueue');
const FoodItem = require('../models/FoodItem');
const Resource = require('../models/Resource');
const Household = require('../models/Household');
const Community = require('../models/Community');
const SimulationRun = require('../models/SimulationRun');
const SafetyRule = require('../models/SafetyRule');
const { ApiError, asyncHandler } = require('../middleware/errors');
const { runSimulation } = require('../services/simulationEngine');

const COLLECTIONS = {
  food_items: FoodItem,
  resources: Resource,
  households: Household,
  communities: Community
};

function normalizeItem(raw) {
  const item = { ...raw };
  if (!item.operation && typeof item.type === 'string' && item.type.includes('.')) {
    const [collection, operation] = item.type.split('.');
    item.collection = item.collection || collection;
    item.operation = operation;
  }
  return item;
}

// Conflict-safe update: if the record changed on the server AFTER the client's
// baseUpdatedAt, do NOT overwrite — return status "conflict" with the server
// document so the coordinator can choose. force:true applies regardless.
async function applyUpdate(Model, item) {
  const doc = await Model.findById(item.recordId);
  if (!doc) return { collection: item.collection, recordId: item.recordId, status: 'skipped', reason: 'not found' };

  if (!item.force && item.baseUpdatedAt && doc.updatedAt) {
    const base = new Date(item.baseUpdatedAt).getTime();
    const server = new Date(doc.updatedAt).getTime();
    if (!isNaN(base) && !isNaN(server) && server > base) {
      return {
        collection: item.collection, recordId: String(doc._id), status: 'conflict',
        reason: 'Record was changed online after your offline edit.',
        serverDoc: {
          _id: String(doc._id), name: doc.name, quantity: doc.quantity, unit: doc.unit,
          category: doc.category, storageType: doc.storageType, status: doc.status,
          priority: doc.priority, updatedAt: doc.updatedAt
        }
      };
    }
  }

  const payload = { ...(item.payload || {}) };
  delete payload._id;
  const updated = await Model.findByIdAndUpdate(item.recordId, payload, { new: true, runValidators: true });
  return { collection: item.collection, recordId: String(updated._id), status: 'updated' };
}

// Offline simulation sync: the server RE-RUNS the authoritative engine with
// current data and stores the run (the offline local result was provisional).
async function applySimulationCreate(item) {
  const p = item.payload || {};
  if (!p.communityId || !p.config) {
    throw new ApiError(400, 'simulationRuns create requires payload { communityId, config }.');
  }
  const community = await Community.findById(p.communityId);
  if (!community) throw new ApiError(404, `Community not found: ${p.communityId}`);

  const cfg = {
    disasterType: p.config.disasterType,
    durationHours: Number(p.config.durationHours),
    internetOff: !!p.config.internetOff,
    floodExposure: !!p.config.floodExposure,
    ambientTempC: Number(p.config.ambientTempC)
  };
  if (!['flood', 'outage', 'flood+outage'].includes(cfg.disasterType) ||
      !Number.isFinite(cfg.durationHours) || !Number.isFinite(cfg.ambientTempC)) {
    throw new ApiError(400, 'Invalid simulation config in sync payload.');
  }

  const [foods, resources, rules, households] = await Promise.all([
    FoodItem.find({ communityId: community._id }).lean(),
    Resource.find({ communityId: community._id }).lean(),
    SafetyRule.find({ active: true }).lean(),
    Household.countDocuments({ communityId: community._id })
  ]);

  const engine = runSimulation({ ...community.toObject(), households }, cfg, foods, resources, rules);
  const run = await SimulationRun.create({
    communityId: community._id,
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
  return { collection: 'simulationRuns', recordId: String(run._id), status: 'created (recomputed from offline request)' };
}

async function applyOne(item) {
  if (!item.deviceId) throw new ApiError(400, 'Field "deviceId" is required.');

  if (item.collection === 'simulationRuns') {
    if (item.operation !== 'create') throw new ApiError(400, 'simulationRuns supports operation "create" only.');
    return applySimulationCreate(item);
  }

  const Model = COLLECTIONS[item.collection];
  if (!Model) {
    throw new ApiError(400, `Unknown collection "${item.collection}". Allowed: ${Object.keys(COLLECTIONS).join(', ')}, simulationRuns.`);
  }
  if (!['create', 'update', 'delete'].includes(item.operation)) {
    throw new ApiError(400, `Invalid operation "${item.operation}". Allowed: create, update, delete.`);
  }
  const recordId = item.recordId || (item.payload && item.payload._id) || null;

  if (item.operation === 'delete') {
    if (!recordId) throw new ApiError(400, 'Delete requires "recordId".');
    const doc = await Model.findByIdAndDelete(recordId);
    if (!doc) return { collection: item.collection, recordId, status: 'skipped', reason: 'not found' };
    return { collection: item.collection, recordId, status: 'deleted' };
  }
  if (item.operation === 'update') {
    if (!recordId) throw new ApiError(400, 'Update requires "recordId".');
    return applyUpdate(Model, item);
  }

  // create — idempotent when the client supplied its original _id
  const payload = { ...(item.payload || {}) };
  try {
    const doc = await Model.create(payload);
    return { collection: item.collection, recordId: String(doc._id), status: 'created' };
  } catch (err) {
    if (err.code === 11000 && payload._id) {
      const p = { ...payload }; delete p._id;
      const doc = await Model.findByIdAndUpdate(payload._id, p, { new: true, runValidators: true });
      if (doc) return { collection: item.collection, recordId: String(doc._id), status: 'updated (already existed)' };
    }
    throw err;
  }
}

// POST /api/sync — body: single item or { items: [ ... ] }
exports.sync = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const rawItems = Array.isArray(body.items) ? body.items : [body];
  if (!rawItems.length) throw new ApiError(400, 'Nothing to synchronise — send an item or { items: [...] }.');

  const results = [];
  for (const raw of rawItems) {
    const item = normalizeItem(raw);
    try {
      const result = await applyOne(item);
      results.push(result);
      await SyncQueue.create({
        deviceId: item.deviceId || 'unknown',
        operation: item.operation,
        collection: item.collection,
        recordId: item.recordId || (result && result.recordId) || null,
        payload: item.payload || {},
        createdOfflineAt: item.createdOfflineAt || item.requestedOfflineAt || null,
        synced: result.status !== 'conflict',
        syncedAt: new Date()
      });
    } catch (err) {
      results.push({ collection: item.collection, operation: item.operation, status: 'failed', reason: err.message });
    }
  }
  const applied = results.filter(r => r.status !== 'failed' && r.status !== 'conflict').length;
  res.json({ ok: true, received: rawItems.length, applied, results });
});