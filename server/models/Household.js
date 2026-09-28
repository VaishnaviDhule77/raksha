const mongoose = require('mongoose');

const householdSchema = new mongoose.Schema({
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  // Anonymous code (e.g. HH-014) — no real names, phones or addresses in the prototype
  householdCode: { type: String, required: [true, 'householdCode is required'], trim: true },
  members: { type: Number, required: true, min: 1, max: 30 },
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  powerBackup: { type: String, enum: ['none', 'generator', 'solar', 'battery', 'other'], default: 'none' },
  storageAccess: { type: String, enum: ['none', 'shared', 'private'], default: 'none' },
  consentToShareResources: { type: Boolean, default: false }
}, { timestamps: true });

householdSchema.index({ communityId: 1, householdCode: 1 }, { unique: true });

module.exports = mongoose.model('Household', householdSchema);