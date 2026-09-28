require('dotenv').config();
const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[RAKSHA db] MONGODB_URI is not set. Copy .env.example to .env and configure it.');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(uri);
    console.log('[RAKSHA db] Connected to MongoDB →', mongoose.connection.name);
  } catch (err) {
    console.error('[RAKSHA db] Connection failed:', err.message);
    console.error('[RAKSHA db] Is MongoDB running? (local: start "mongod" / the MongoDB service; Atlas: check the URI)');
    process.exit(1);
  }
}

module.exports = connectMongo;