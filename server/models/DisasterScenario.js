const mongoose = require('mongoose');

const scenarioSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Scenario name is required'], trim: true },
  disasterType: { type: String, enum: ['flood', 'outage', 'flood+outage'], required: true },
  durationHours: { type: Number, required: true, min: 1, max: 336 },
  powerAvailable: { type: Boolean, default: true },
  internetAvailable: { type: Boolean, default: true },
  floodExposure: { type: Boolean, default: false },
  ambientTemperature: { type: Number, required: true, min: -10, max: 60 }
}, { timestamps: true });

module.exports = mongoose.model('DisasterScenario', scenarioSchema);