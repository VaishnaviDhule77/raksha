const mongoose = require('mongoose');

const metricsSchema = new mongoose.Schema({
  totalKg: Number, needKg: Number, protectedKg: Number, gapKg: Number,
  criticalKg: Number, criticalCount: Number, unprotectedKg: Number
}, { _id: false });

const simulationRunSchema = new mongoose.Schema({
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  scenarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'DisasterScenario', default: null },
  startedAt: { type: Date, default: Date.now, index: true },
  // Raw scenario configuration this run was executed with
  config: {
    disasterType: String, durationHours: Number, internetOff: Boolean,
    floodExposure: Boolean, ambientTempC: Number
  },
  baselineMetrics: metricsSchema,   // "as stored today" outcome
  resultMetrics: metricsSchema,     // metrics of the strategy currently presented
  optimizedMetrics: metricsSchema,  // metrics after resource optimization
  preparednessScore: {
    score: Number, band: String,
    components: [{ key: String, label: String, weight: Number, score: Number }],
    disclaimer: { type: String, default: 'Prototype preparedness index; not a validated disaster-risk score.' }
  },
  gaps: [{ code: String, severity: String, title: String, detail: String }],
  recommendations: [{ tier: String, title: String, detail: String, time: String, category: String }],
  // Full result snapshots (baseline presented first; optimization swaps to optimizedResult)
  result: { type: mongoose.Schema.Types.Mixed, default: {} },
  optimizedResult: { type: mongoose.Schema.Types.Mixed, default: {} },
  plan: { type: mongoose.Schema.Types.Mixed, default: null },
  optimized: { type: Boolean, default: false },
  optimizedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('SimulationRun', simulationRunSchema);