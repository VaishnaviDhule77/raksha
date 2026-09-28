const mongoose = require('mongoose');

// Safety rules are CONFIGURABLE, SOURCE-BACKED DATA — never hardcoded engine logic.
//
// "trigger"    — when the rule applies (scenario context)
// "appliesTo"  — which food the rule classifies (categories / storageTypes).
//                Rules WITHOUT appliesTo are scenario-level practice rules
//                (e.g. generator management) and do not classify food.
const safetyRuleSchema = new mongoose.Schema({
  ruleCode: { type: String, required: [true, 'ruleCode is required'], unique: true, trim: true },
  condition: { type: String, required: [true, 'Condition is required'] },
  action: { type: String, required: [true, 'Action is required'] },
  priority: { type: String, enum: ['Critical', 'High', 'Medium', 'Low'], default: 'Medium' },
  explanation: { type: String, default: '' },
  sourceOrganization: { type: String, default: '' },
  sourceUrl: { type: String, default: '' },
  jurisdiction: { type: String, default: '' },
  lastVerified: { type: String, default: '' },   // YYYY-MM-DD
  trigger: {
    floodExposure: { type: Boolean, default: false },   // applies only when flood exposure is YES
    powerOutage: { type: Boolean, default: false },     // applies only when power is OFF
    generatorPresent: { type: Boolean, default: false } // applies only when a generator exists
  },
  appliesTo: {
    categories: { type: [String], default: [] },     // food categories this rule classifies
    storageTypes: { type: [String], default: [] }    // storage types this rule classifies
  },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SafetyRule', safetyRuleSchema);