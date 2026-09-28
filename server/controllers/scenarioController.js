const DisasterScenario = require('../models/DisasterScenario');
const { ApiError, asyncHandler } = require('../middleware/errors');

// GET /api/scenarios
exports.list = asyncHandler(async (req, res) => {
  res.json(await DisasterScenario.find().sort('durationHours').lean());
});

// POST /api/scenarios
exports.create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  ['name', 'disasterType', 'durationHours', 'ambientTemperature'].forEach(f => {
    if (b[f] == null) throw new ApiError(400, `Field "${f}" is required.`);
  });
  if (!['flood', 'outage', 'flood+outage'].includes(b.disasterType)) {
    throw new ApiError(400, '"disasterType" must be flood, outage or flood+outage.');
  }
  if (b.durationHours < 1 || b.durationHours > 336) {
    throw new ApiError(400, '"durationHours" must be between 1 and 336.');
  }
  if (b.ambientTemperature < -10 || b.ambientTemperature > 60) {
    throw new ApiError(400, '"ambientTemperature" must be between -10 and 60.');
  }
  res.status(201).json(await DisasterScenario.create(b));
});

// GET /api/scenarios/:id
exports.getOne = asyncHandler(async (req, res) => {
  const scenario = await DisasterScenario.findById(req.params.id).lean();
  if (!scenario) throw new ApiError(404, 'Scenario not found.');
  res.json(scenario);
});