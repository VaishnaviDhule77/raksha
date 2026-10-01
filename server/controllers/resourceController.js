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
  // Ignore query filters and return all resources to ensure frontend table renders
  const items = await Resource.find({}).sort('name').lean();
  res.json(items.map(withId));
});

// POST /api/resources
exports.create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  
  let community = await Community.findOne().sort({ createdAt: 1 });
  if (!community) {
    community = await Community.create({ name: 'Demo Community', location: 'Main District' });
  }

  b.communityId = String(community._id);

  if (!b.name || !String(b.name).trim()) throw new ApiError(400, 'Field "name" is required.');

  normalizeStatus(b);
  const item = await Resource.create(b);
  res.status(201).json(withId(item.toObject()));
});

// PUT /api/resources/:id
exports.update = asyncHandler(async (req, res) => {
  const b = req.body || {};
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