const router = require('express').Router();
const Household = require('../models/Household');
const Community = require('../models/Community');
const { ApiError, asyncHandler } = require('../middleware/errors');

router.get('/', asyncHandler(async (req, res) => {
  const filter = req.query.communityId ? { communityId: req.query.communityId } : {};
  res.json(await Household.find(filter).sort('householdCode').lean());
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.communityId) throw new ApiError(400, 'Field "communityId" is required.');
  if (!b.householdCode || !String(b.householdCode).trim()) {
    throw new ApiError(400, 'Field "householdCode" is required (anonymous code, e.g. HH-014).');
  }
  if (!b.members || typeof b.members !== 'number' || b.members < 1) {
    throw new ApiError(400, 'Field "members" must be a number ≥ 1.');
  }
  const community = await Community.findById(b.communityId);
  if (!community) throw new ApiError(404, `Community not found: ${b.communityId}`);
  res.status(201).json(await Household.create(b));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const hh = await Household.findById(req.params.id).lean();
  if (!hh) throw new ApiError(404, 'Household not found.');
  res.json(hh);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const hh = await Household.findByIdAndUpdate(req.params.id, req.body || {}, { new: true, runValidators: true });
  if (!hh) throw new ApiError(404, 'Household not found.');
  res.json(hh);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const hh = await Household.findByIdAndDelete(req.params.id);
  if (!hh) throw new ApiError(404, 'Household not found.');
  res.json({ ok: true });
}));

module.exports = router;