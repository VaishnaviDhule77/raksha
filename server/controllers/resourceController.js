const Resource = require('../models/Resource');
const Community = require('../models/Community');
const { ApiError, asyncHandler } = require('../middleware/errors');

const withId = (d) => ({ ...d, id: String(d._id) });

// Keep operational (boolean) and operationalStatus (string) consistent.
function normalizeStatus(b) {
  if (typeof b.operationalStatus === 'string') {
    b.operational = b.operationalStatus === 'Operational';
  } else if (typeof b.operational === 'boolean') {
    b.operationalStatus = b.operational ? 'Operational' : 'Non-functional';
  }
}

// GET /api/resources?communityId=&type=
exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.communityId) filter.communityId = req.query.communityId;
  if (req.query.type) filter.type = req.query.type;
  const items = await Resource.find(filter).sort('name').lean();
  res.json(items.map(withId));
});

// POST /api/resources
exports.create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.communityId) throw new ApiError(400, 'Field "communityId" is required.');
  const community = await Community.findById(b.communityId);
  if (!community) throw new ApiError(404, `Community not found: ${b.communityId}`);
  if (!b.name || !String(b.name).trim()) throw new ApiError(400, 'Field "name" is required.');
  if (b.capacity == null || typeof b.capacity !== 'number' || b.capacity < 0) {
    throw new ApiError(400, 'Field "capacity" must be a number ≥ 0.');
  }
  normalizeStatus(b);
  const item = await Resource.create(b);
  res.status(201).json(withId(item.toObject()));
});

// PUT /api/resources/:id
exports.update = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.name != null && !String(b.name).trim()) throw new ApiError(400, '"name" cannot be empty.');
  if (b.capacity != null && (typeof b.capacity !== 'number' || b.capacity < 0)) {
    throw new ApiError(400, '"capacity" must be a number ≥ 0.');
  }
  normalizeStatus(b);
  const item = await Resource.findByIdAndUpdate(req.params.id, b, { new: true, runValidators: true }).lean();
  if (!item) throw new ApiError(404, 'Resource not found.');
  res.json(withId(item));
});

// DELETE /api/resources/:id
exports.remove = asyncHandler(async (req, res) => {
  const item = await Resource.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Resource not found.');
  res.json({ ok: true, deleted: item.name });
});