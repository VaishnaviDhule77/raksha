const router = require('express').Router();
const SimulationRun = require('../models/SimulationRun');
const ActionPlan = require('../models/ActionPlan');
const { ApiError, asyncHandler } = require('../middleware/errors');

// GET /api/action-plans?runId=... — frontend compatibility
router.get('/', asyncHandler(async (req, res) => {
  if (!req.query.runId) throw new ApiError(400, 'Query parameter "runId" is required.');
  const run = await SimulationRun.findById(req.query.runId);
  if (!run) throw new ApiError(404, 'Simulation not found.');
  if (!run.plan) throw new ApiError(404, 'No action plan generated for this simulation yet. POST /api/simulations/:id/plan first.');
  res.json(run.plan);
}));

// GET /api/action-plans/latest?communityId=... — frontend compatibility
router.get('/latest', asyncHandler(async (req, res) => {
  const filter = req.query.communityId ? { communityId: req.query.communityId } : {};
  const run = await SimulationRun.findOne(filter).sort({ startedAt: -1 });
  if (!run || !run.plan) return res.json(null);
  res.json(run.plan);
}));

// GET /api/action-plans/:simulationId — primary (spec): composite plan + action documents
router.get('/:simulationId', asyncHandler(async (req, res) => {
  const run = await SimulationRun.findById(req.params.simulationId);
  if (!run) throw new ApiError(404, 'Simulation not found.');
  if (!run.plan) throw new ApiError(404, 'No action plan generated for this simulation yet. POST /api/simulations/:id/plan first.');
  const actions = await ActionPlan.find({ simulationId: run._id }).sort('priority').lean();
  res.json({ ...run.plan, actionDocuments: actions });
}));

module.exports = router;