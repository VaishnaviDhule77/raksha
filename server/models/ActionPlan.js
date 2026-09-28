const mongoose = require('mongoose');

const actionPlanSchema = new mongoose.Schema({
  simulationId: { type: mongoose.Schema.Types.ObjectId, ref: 'SimulationRun', required: true, index: true },
  priority: { type: String, enum: ['P1', 'P2', 'P3'], required: true },
  action: { type: String, required: true },
  category: { type: String, default: 'general' },
  status: { type: String, enum: ['pending', 'in-progress', 'done'], default: 'pending' },
  sourceRuleId: { type: mongoose.Schema.Types.ObjectId, ref: 'SafetyRule', default: null },
  offlineAvailable: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('ActionPlan', actionPlanSchema);