const mongoose = require('mongoose');

const syncQueueSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, trim: true },
  operation: { type: String, enum: ['create', 'update', 'delete'], required: true },
  collection: { type: String, required: true, trim: true },
  recordId: { type: String, default: null },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdOfflineAt: { type: Date, default: null },
  synced: { type: Boolean, default: false },
  syncedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('SyncQueue', syncQueueSchema);