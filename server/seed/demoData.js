require('dotenv').config();
const mongoose = require('mongoose');
const connectMongo = require('../config/db');
const Community = require('../models/Community');
const Household = require('../models/Household');
const FoodItem = require('../models/FoodItem');
const Resource = require('../models/Resource');
const DisasterScenario = require('../models/DisasterScenario');
const SafetyRule = require('../models/SafetyRule');
const SimulationRun = require('../models/SimulationRun');
const ActionPlan = require('../models/ActionPlan');
const SyncQueue = require('../models/SyncQueue');
const { runSimulation } = require('../services/simulationEngine');

async function seed() {
  await connectMongo();

  console.log('[seed] Wiping existing data...');
  await Promise.all([
    Community.deleteMany({}), Household.deleteMany({}), FoodItem.deleteMany({}),
    Resource.deleteMany({}), DisasterScenario.deleteMany({}), SafetyRule.deleteMany({}),
    SimulationRun.deleteMany({}), ActionPlan.deleteMany({}), SyncQueue.deleteMany({})
  ]);

  const community = await Community.create({
    name: 'Demo Village',
    region: 'Coastal district (demo)',
    location: { lat: 13.0827, lng: 80.2707 },
    population: 0,
    coordinatorId: 'coord-demo-001'
  });

  const householdDocs = [];
  for (let i = 1; i <= 100; i++) {
    householdDocs.push({
      communityId: community._id,
      householdCode: `HH-${String(i).padStart(3, '0')}`,
      members: 3 + (i % 4),
      location: {
        lat: 13.0827 + ((i % 10) - 5) * 0.001,
        lng: 80.2707 + (Math.floor(i / 10) - 5) * 0.001
      },
      powerBackup: i % 5 === 0 ? 'generator' : 'none',
      storageAccess: i % 3 === 0 ? 'shared' : 'none',
      consentToShareResources: i % 10 < 6
    });
  }
  const households = await Household.insertMany(householdDocs);
  community.population = households.reduce((s, h) => s + h.members, 0);
  await community.save();

  await Resource.insertMany([
    { communityId: community._id, name: 'Refrigerator A', type: 'Refrigerator', capacity: 50, unit: 'kg', location: 'Community hall - kitchen', powerSource: 'Grid', operational: true, operationalStatus: 'Operational', poweredByGenerator: true, availability: 'Available', ownerType: 'Community', availableOffline: true },
    { communityId: community._id, name: 'Refrigerator B', type: 'Refrigerator', capacity: 50, unit: 'kg', location: 'Shelter block C', powerSource: 'Grid', operational: true, operationalStatus: 'Operational', poweredByGenerator: false, availability: 'Available', ownerType: 'Community', availableOffline: true },
    { communityId: community._id, name: 'Freezer', type: 'Freezer', capacity: 40, unit: 'kg', location: 'Community hall - kitchen', powerSource: 'Grid', operational: true, operationalStatus: 'Operational', poweredByGenerator: true, availability: 'Available', ownerType: 'Community', availableOffline: true },
    { communityId: community._id, name: 'Cold box', type: 'Cold box', capacity: 20, unit: 'kg', location: 'Mobile / shelter block C', powerSource: 'Ice', operational: true, operationalStatus: 'Operational', poweredByGenerator: false, availability: 'Available', ownerType: 'NGO', availableOffline: true },
    { communityId: community._id, name: 'Generator', type: 'Generator', capacity: 1, unit: 'units', location: 'Community hall', powerSource: 'Fuel', operational: true, operationalStatus: 'Operational', availability: 'Available', ownerType: 'Community', availableOffline: true },
    { communityId: community._id, name: 'Ice stock', type: 'Ice supply', capacity: 20, unit: 'kg', location: 'Community hall freezer room', powerSource: 'None', operational: true, operationalStatus: 'Operational', availability: 'Available', ownerType: 'Community', availableOffline: true }
  ]);

  await FoodItem.insertMany([
    { communityId: community._id, householdId: null, name: 'Cooked food (rice & curry)', category: 'Cooked', quantity: 30, unit: 'kg', storageType: 'Refrigerated', cooked: true, sealed: false, status: 'PRIORITY', priority: 'High' },
    { communityId: community._id, householdId: null, name: 'Milk', category: 'Dairy', quantity: 20, unit: 'L', storageType: 'Refrigerated', cooked: false, sealed: true, status: 'CRITICAL', priority: 'Critical' },
    { communityId: community._id, householdId: null, name: 'Fresh vegetables', category: 'Vegetables', quantity: 40, unit: 'kg', storageType: 'Ambient', status: 'PROTECT', priority: 'Medium' },
    { communityId: community._id, householdId: null, name: 'Meat & fish', category: 'Meat', quantity: 20, unit: 'kg', storageType: 'Frozen', status: 'CRITICAL', priority: 'Critical' },
    { communityId: community._id, householdId: null, name: 'Frozen food', category: 'Frozen', quantity: 30, unit: 'kg', storageType: 'Frozen', status: 'PRIORITY', priority: 'High' },
    { communityId: community._id, householdId: null, name: 'Rice & grains', category: 'Grains', quantity: 80, unit: 'kg', storageType: 'Ambient', status: 'STABLE', priority: 'Low' },
    { communityId: community._id, householdId: null, name: 'Canned food', category: 'Canned', quantity: 50, unit: 'kg', storageType: 'Ambient', sealed: true, status: 'STABLE', priority: 'Low' }
  ]);

  await DisasterScenario.insertMany([
    { name: '12-hour power outage', disasterType: 'outage', durationHours: 12, powerAvailable: false, internetAvailable: true, floodExposure: false, ambientTemperature: 30 },
    { name: '24-hour flood + power outage', disasterType: 'flood+outage', durationHours: 24, powerAvailable: false, internetAvailable: false, floodExposure: true, ambientTemperature: 32 },
    { name: '48-hour flood + power outage', disasterType: 'flood+outage', durationHours: 48, powerAvailable: false, internetAvailable: false, floodExposure: true, ambientTemperature: 32 }
  ]);

  // Safety rules — source-backed, configurable, now with food targeting (appliesTo).
  // Verify URLs before the competition.
  await SafetyRule.insertMany([
    {
      ruleCode: 'FS-FLOOD-01',
      condition: 'Food has come into contact with flood water or flood-contaminated surfaces',
      action: 'Discard affected food. Undamaged commercially canned items may be sanitised per published guidance.',
      priority: 'Critical',
      explanation: 'Flood water can carry sewage and chemical contamination.',
      sourceOrganization: 'U.S. FDA',
      sourceUrl: 'https://www.fda.gov/food/buy-store-serve-safe-food/food-safety-during-emergencies',
      jurisdiction: 'US (example rule)', lastVerified: '2024-06-01',
      trigger: { floodExposure: true, powerOutage: false, generatorPresent: false },
      appliesTo: {
        categories: ['Cooked', 'Dairy', 'Vegetables', 'Fruits', 'Meat', 'Frozen', 'Grains', 'Canned', 'Other'],
        storageTypes: ['Ambient', 'Refrigerated', 'Frozen']
      },
      active: true
    },
    {
      ruleCode: 'FS-REFR-02',
      condition: 'Refrigerated perishable food held above 4 C during an outage',
      action: 'Discard perishables held above 4 C beyond the configured limit; never rely on smell or taste.',
      priority: 'Critical',
      explanation: 'Published outage guidance for refrigerated perishables.',
      sourceOrganization: 'USDA Food Safety and Inspection Service',
      sourceUrl: 'https://www.fsis.usda.gov/guides/severe-storms-and-hurricane-guide',
      jurisdiction: 'US (example rule)', lastVerified: '2024-06-01',
      trigger: { floodExposure: false, powerOutage: true, generatorPresent: false },
      appliesTo: { categories: ['Cooked', 'Dairy'], storageTypes: ['Refrigerated'] },
      active: true
    },
    {
      ruleCode: 'FS-FRZ-01',
      condition: 'Freezer without power',
      action: 'Keep the freezer closed; a full freezer holds temperature about 48 h, a half-full one about 24 h.',
      priority: 'High',
      explanation: 'Published freezer hold-time guidance during outages.',
      sourceOrganization: 'USDA Food Safety and Inspection Service',
      sourceUrl: 'https://www.fsis.usda.gov/guides/severe-storms-and-hurricane-guide',
      jurisdiction: 'US (example rule)', lastVerified: '2024-06-01',
      trigger: { floodExposure: false, powerOutage: true, generatorPresent: false },
      appliesTo: { categories: ['Frozen', 'Meat'], storageTypes: ['Frozen'] },
      active: true
    },
    {
      ruleCode: 'FS-GEN-01',
      condition: 'Community generator available during an outage',
      action: 'Prioritise cold-chain appliances on the generator circuit and plan fuel rotation.',
      priority: 'Medium',
      explanation: 'Prototype default practice — replace with locally verified guidance.',
      sourceOrganization: 'RAKSHA community practice (prototype default)',
      sourceUrl: '', jurisdiction: 'Community', lastVerified: '',
      trigger: { floodExposure: false, powerOutage: true, generatorPresent: true },
      active: true
    }
  ]);

  const [foods, resources, rules] = await Promise.all([
    FoodItem.find({ communityId: community._id }).lean(),
    Resource.find({ communityId: community._id }).lean(),
    SafetyRule.find({ active: true }).lean()
  ]);
  const cfg = { disasterType: 'flood+outage', durationHours: 24, internetOff: true, floodExposure: true, ambientTempC: 32 };
  const engine = runSimulation({ ...community.toObject(), households: households.length }, cfg, foods, resources, rules);
  const run = await SimulationRun.create({
    communityId: community._id,
    config: cfg,
    baselineMetrics: engine.baselineMetrics,
    resultMetrics: engine.baselineMetrics,
    optimizedMetrics: engine.optimizedMetrics,
    preparednessScore: engine.baselineResult.preparednessScore,
    gaps: engine.baselineResult.preparednessGaps,
    recommendations: engine.baselineResult.recommendations,
    result: engine.baselineResult,
    optimizedResult: engine.optimizedResult,
    optimized: false
  });

  console.log('--------------------------------------------------');
  console.log('Seed complete:');
  console.log(`  Community : ${community.name} - ${households.length} households, population ${community.population}`);
  console.log('  Data      : 7 food items, 6 resources, 3 scenarios, 4 safety rules (with appliesTo)');
  console.log(`  Demo run  : 24 h flood + outage -> baseline gap ${engine.baselineMetrics.gapKg} kg, ` +
    `after optimization ${engine.optimizedMetrics.gapKg} kg (run ${run._id})`);
  console.log(`  Community ID (for API calls): ${community._id}`);
  console.log('--------------------------------------------------');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});