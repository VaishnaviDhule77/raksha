const mongoose = require('mongoose');

const foodItemSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', default: null }, // null = community-level store
  communityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  name: { type: String, required: [true, 'Food name is required'], trim: true, maxlength: 80 },
  category: {
    type: String, required: [true, 'Category is required'],
    enum: ['Cooked', 'Dairy', 'Vegetables', 'Fruits', 'Meat', 'Frozen', 'Grains', 'Canned', 'Other']
  },
  quantity: { type: Number, required: true, min: [0.01, 'Quantity must be greater than 0'] },
  unit: { type: String, enum: ['kg', 'L', 'units'], default: 'kg' },
  storageType: { type: String, enum: ['Ambient', 'Refrigerated', 'Frozen'], default: 'Ambient' },
  storedAt: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', default: null }, // resource where this food currently sits
  cooked: { type: Boolean, default: false },
  sealed: { type: Boolean, default: false },
  floodExposure: { type: Boolean, default: false },
  currentTemperature: { type: Number, default: null },
  status: {
    type: String, default: 'PROTECT',
    enum: ['CRITICAL', 'PRIORITY', 'PROTECT', 'STABLE', 'UNSAFE']
  },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' }
}, { timestamps: true });

module.exports = mongoose.model('FoodItem', foodItemSchema);