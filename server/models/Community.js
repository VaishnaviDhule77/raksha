const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Community name is required'], trim: true, unique: true },
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  population: { type: Number, default: 0, min: 0 },
  // Prototype: free-form coordinator reference (no auth system in this phase)
  coordinatorId: { type: String, default: '' },
  region: { type: String, default: '' }
}, { timestamps: true }); // createdAt / updatedAt

module.exports = mongoose.model('Community', communitySchema);