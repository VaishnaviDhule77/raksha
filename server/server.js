require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectMongo = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errors');

const communityRoutes = require('./routes/communityRoutes');
const householdRoutes = require('./routes/householdRoutes');
const foodRoutes = require('./routes/foodRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const scenarioRoutes = require('./routes/scenarioRoutes');
const safetyRuleRoutes = require('./routes/safetyRuleRoutes');
const simulationRoutes = require('./routes/simulationRoutes');
const actionPlanRoutes = require('./routes/actionPlanRoutes');
const syncRoutes = require('./routes/syncRoutes');
const communityController = require('./controllers/communityController');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Tiny request log — useful during the demo
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start} ms)`);
  });
  next();
});

// ── Legacy community ID resolver (frontend compatibility shim) ──
// The frontend prototype was built before the backend existed and sends its
// built-in demo dataset's community ID ("comm-demo-001"), which is not a
// MongoDB ObjectId. This middleware rewrites any non-ObjectId communityId
// (query, body, or sync-item payload) to the first real community in the
// database — the single-community assumption of the prototype.
app.use(async (req, res, next) => {
  try {
    const Community = mongoose.model('Community');
    const fix = async (val) => {
      if (!val || mongoose.isValidObjectId(val)) return val; // valid ObjectId → leave untouched
      const community = await Community.findOne().sort({ createdAt: 1 }).lean();
      return community ? String(community._id) : val;        // no community in DB → let controllers report it
    };
    if (req.query.communityId) req.query.communityId = await fix(req.query.communityId);
    if (req.body && typeof req.body === 'object') {
      if (req.body.communityId) req.body.communityId = await fix(req.body.communityId);
      if (req.body.payload && req.body.payload.communityId) {
        req.body.payload.communityId = await fix(req.body.payload.communityId);
      }
      if (Array.isArray(req.body.items)) {
        for (const item of req.body.items) {
          if (item && item.payload && item.payload.communityId) {
            item.payload.communityId = await fix(item.payload.communityId);
          }
        }
      }
    }
  } catch (err) {
    // Never block a request because of the shim — let normal error handling deal with it
    console.warn('[RAKSHA] Community resolver skipped:', err.message);
  }
  next();
});

// Liveness probe — the frontend uses this to switch to LIVE DATA mode
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', service: 'raksha-api', time: new Date().toISOString() }));

// ── API routes (spec paths) ─────────────────────────────────
app.use('/api/communities', communityRoutes);
app.use('/api/households', householdRoutes);
app.use('/api/food', foodRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/scenarios', scenarioRoutes);
app.use('/api/safety-rules', safetyRuleRoutes);
app.use('/api/simulations', simulationRoutes);
app.use('/api/action-plans', actionPlanRoutes);
app.use('/api/sync', syncRoutes);

// ── Frontend-compatibility aliases (the client/ pages call these) ──
app.use('/api/food-items', foodRoutes);
app.get('/api/dashboard/summary', communityController.dashboardSummary);

// ── Serve the frontend (client/) from the same origin when present ──
const clientDir = path.join(__dirname, '..', 'client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
connectMongo().then(() => {
  app.listen(PORT, () => {
    console.log(`[RAKSHA] API  ready -> http://localhost:${PORT}/api/health`);
    if (fs.existsSync(clientDir)) console.log(`[RAKSHA] App  ready -> http://localhost:${PORT}`);
  });
});