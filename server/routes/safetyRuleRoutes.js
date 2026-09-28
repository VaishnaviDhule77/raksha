const router = require('express').Router();
const SafetyRule = require('../models/SafetyRule');
const { ApiError, asyncHandler } = require('../middleware/errors');

// GET /api/safety-rules — rules are global configuration; communityId is accepted and ignored
router.get('/', asyncHandler(async (req, res) => {
  const filter = req.query.active === 'false' ? { active: false } : { active: true };
  res.json(await SafetyRule.find(filter).sort('ruleCode').lean());
}));

// POST /api/safety-rules
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  ['ruleCode', 'condition', 'action'].forEach(f => {
    if (!b[f] || !String(b[f]).trim()) throw new ApiError(400, `Field "${f}" is required.`);
  });
  res.status(201).json(await SafetyRule.create(b));
}));

// PUT /api/safety-rules/:id — edit rules without redeploying (rules are data)
router.put('/:id', asyncHandler(async (req, res) => {
  const rule = await SafetyRule.findByIdAndUpdate(req.params.id, req.body || {}, { new: true, runValidators: true });
  if (!rule) throw new ApiError(404, 'Safety rule not found.');
  res.json(rule);
}));

module.exports = router;