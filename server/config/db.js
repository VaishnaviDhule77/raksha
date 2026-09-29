require('dotenv').config();
const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[RAKSHA db] MONGODB_URI is not set.');
    console.error('           Local:  copy .env.example to .env and set MONGODB_URI');
    console.error('           Render: add MONGODB_URI in the dashboard (Environment tab)');
    process.exit(1);
  }

  mongoose.set('strictQuery', true);

  /* ★ NEW: surface connection drops/reconnects in the logs.
     mongoose auto-retries silently by default — in production you want
     to SEE when Atlas drops and when it comes back. */
  mongoose.connection.on('disconnected', () =>
    console.warn('[RAKSHA db] Disconnected from MongoDB — auto-retry in progress'));
  mongoose.connection.on('reconnected', () =>
    console.log('[RAKSHA db] Reconnected to MongoDB'));
  mongoose.connection.on('error', (err) =>
    console.error('[RAKSHA db] Connection error:', err.message));

  try {
    await mongoose.connect(uri);
    console.log('[RAKSHA db] Connected to MongoDB →', mongoose.connection.name);
  } catch (err) {
    console.error('[RAKSHA db] Connection failed:', err.message);
    /* ★ EXPANDED: hints now cover the Render/Atlas failure modes you're
       most likely to actually hit during deployment. */
    console.error('[RAKSHA db] Troubleshooting:');
    console.error('           local:  is mongod running? (Windows service "MongoDB" or run mongod)');
    console.error('           Atlas:  Network Access set to 0.0.0.0/0? password URL-encoded?');
    console.error('           Render: MONGODB_URI set in Environment tab?');
    process.exit(1);
  }
}

module.exports = connectMongo;