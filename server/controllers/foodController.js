const FoodItem = require('../models/FoodItem');
const Community = require('../models/Community');
const { ApiError, asyncHandler } = require('../middleware/errors');

// The frontend keys rows by "id" — expose both _id and id.
const withId = (d) => ({ ...d, id: String(d._id) });

// GET /api/food?communityId=&householdId=&category=&status=
exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.communityId) filter.communityId = req.query.communityId;
  if (req.query.householdId) filter.householdId = req.query.householdId;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.status) filter.status = req.query.status;

  let items = await FoodItem.find(filter).sort('name').lean();

  // Fallback: If no items match the requested communityId or filters, return all available food items
  if (!items || items.length === 0) {
    items = await FoodItem.find({}).sort('name').lean();
  }

  res.json(items.map(withId));
});

// POST /api/food
exports.create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.communityId) throw new ApiError(400, 'Field "communityId" is required.');
  const community = await Community.findById(b.communityId);
  if (!community) throw new ApiError(404, `Community not found: ${b.communityId}`);
  if (!b.name || !String(b.name).trim()) throw new ApiError(400, 'Field "name" is required.');
  if (b.quantity == null || typeof b.quantity !== 'number' || b.quantity <= 0) {
    throw new ApiError(400, 'Field "quantity" must be a number greater than 0.');
  }
  const item = await FoodItem.create(b);
  res.status(201).json(withId(item.toObject()));
});

// GET /api/food/:id
exports.getOne = asyncHandler(async (req, res) => {
  const item = await FoodItem.findById(req.params.id).lean();
  if (!item) throw new ApiError(404, 'Food item not found.');
  res.json(withId(item));
});

// PUT /api/food/:id
exports.update = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.name != null && !String(b.name).trim()) throw new ApiError(400, '"name" cannot be empty.');
  if (b.quantity != null && (typeof b.quantity !== 'number' || b.quantity <= 0)) {
    throw new ApiError(400, '"quantity" must be a number greater than 0.');
  }
  const item = await FoodItem.findByIdAndUpdate(req.params.id, b, { new: true, runValidators: true }).lean();
  if (!item) throw new ApiError(404, 'Food item not found.');
  res.json(withId(item));
});

// DELETE /api/food/:id
exports.remove = asyncHandler(async (req, res) => {
  const item = await FoodItem.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Food item not found.');
  res.json({ ok: true, deleted: item.name });
});