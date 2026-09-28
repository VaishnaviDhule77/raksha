const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  name: { type: String, required: [true, 'Resource name is required'], trim: true, maxlength: 80 },
  type: {
    type: String, required: [true, 'Type is required'],
    enum: ['Refrigerator', 'Freezer', 'Cold box', 'Ice supply', 'Generator', 'Dry storage', 'Community kitchen', 'Other']
  },
  capacity: { type: Number, required: true, min: 0 },
  unit: { type: String, enum: ['kg', 'units', 'kW'], default: 'kg' },
  location: { type: String, trim: true, default: '' },
  powerSource: { type: String, enum: ['Grid', 'Generator', 'Fuel', 'Solar', 'Ice', 'None'], default: 'Grid' },
  operational: { type: Boolean, default: true },               // spec field
  operationalStatus: {                                        // human-readable mirror used by the frontend
    type: String, enum: ['Operational', 'Maintenance', 'Non-functional'], default: 'Operational'
  },
  poweredByGenerator: { type: Boolean, default: false },       // on the generator circuit
  availability: { type: String, enum: ['Available', 'In use', 'Reserved'], default: 'Available' },
  ownerType: { type: String, enum: ['Community', 'Household', 'NGO', 'Government', 'Private'], default: 'Community' },
  availableOffline: { type: Boolean, default: true }           // spec field: record cached for offline use
}, { timestamps: true });

// Keep operational (boolean) and operationalStatus (string) consistent on save
resourceSchema.pre('save', function (next) {
  this.operational = this.operationalStatus === 'Operational';
  next();
});

module.exports = mongoose.model('Resource', resourceSchema);