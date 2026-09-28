/**
 * RAKSHA engine test suite — run with:  npm test
 * (Node's built-in test runner; no new dependencies)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { runSimulation } = require('../services/simulationEngine');

/* ── fixtures (mirror of seed data) ── */

const community = { _id: 'c1', name: 'Demo Village', households: 100, region: 'demo', coordinatorId: 'coord' };

const baseFoods = () => ([
  { _id: 'f1', name: 'Cooked food (rice & curry)', category: 'Cooked', quantity: 30, unit: 'kg', storageType: 'Refrigerated', cooked: true, sealed: false, floodExposure: false },
  { _id: 'f2', name: 'Milk', category: 'Dairy', quantity: 20, unit: 'L', storageType: 'Refrigerated', cooked: false, sealed: true, floodExposure: false },
  { _id: 'f3', name: 'Fresh vegetables', category: 'Vegetables', quantity: 40, unit: 'kg', storageType: 'Ambient', floodExposure: false },
  { _id: 'f4', name: 'Meat & fish', category: 'Meat', quantity: 20, unit: 'kg', storageType: 'Frozen', floodExposure: false },
  { _id: 'f5', name: 'Frozen food', category: 'Frozen', quantity: 30, unit: 'kg', storageType: 'Frozen', floodExposure: false },
  { _id: 'f6', name: 'Rice & grains', category: 'Grains', quantity: 80, unit: 'kg', storageType: 'Ambient', floodExposure: false },
  { _id: 'f7', name: 'Canned food', category: 'Canned', quantity: 50, unit: 'kg', storageType: 'Ambient', sealed: true, floodExposure: false }
]);

const baseResources = () => ([
  { _id: 'r1', name: 'Refrigerator A', type: 'Refrigerator', capacity: 50, unit: 'kg', operational: true, operationalStatus: 'Operational', poweredByGenerator: true },
  { _id: 'r2', name: 'Refrigerator B', type: 'Refrigerator', capacity: 50, unit: 'kg', operational: true, operationalStatus: 'Operational', poweredByGenerator: false },
  { _id: 'r3', name: 'Freezer', type: 'Freezer', capacity: 40, unit: 'kg', operational: true, operationalStatus: 'Operational', poweredByGenerator: true },
  { _id: 'r4', name: 'Cold box', type: 'Cold box', capacity: 20, unit: 'kg', operational: true, operationalStatus: 'Operational', poweredByGenerator: false },
  { _id: 'r5', name: 'Generator', type: 'Generator', capacity: 1, unit: 'units', operational: true, operationalStatus: 'Operational' },
  { _id: 'r6', name: 'Ice stock', type: 'Ice supply', capacity: 20, unit: 'kg', operational: true, operationalStatus: 'Operational' }
]);

const baseRules = () => ([
  { ruleCode: 'FS-FLOOD-01', condition: 'c', action: 'a', priority: 'Critical', explanation: 'e', sourceOrganization: 'U.S. FDA', sourceUrl: 'https://www.fda.gov/...', jurisdiction: 'US (example rule)', lastVerified: '2024-06-01',
    trigger: { floodExposure: true, powerOutage: false, generatorPresent: false },
    appliesTo: { categories: ['Cooked','Dairy','Vegetables','Fruits','Meat','Frozen','Grains','Canned','Other'], storageTypes: ['Ambient','Refrigerated','Frozen'] }, active: true },
  { ruleCode: 'FS-REFR-02', condition: 'c', action: 'a', priority: 'Critical', explanation: 'e', sourceOrganization: 'USDA FSIS', sourceUrl: 'https://www.fsis.usda.gov/...', jurisdiction: 'US (example rule)', lastVerified: '2024-06-01',
    trigger: { floodExposure: false, powerOutage: true, generatorPresent: false },
    appliesTo: { categories: ['Cooked','Dairy'], storageTypes: ['Refrigerated'] }, active: true },
  { ruleCode: 'FS-FRZ-01', condition: 'c', action: 'a', priority: 'High', explanation: 'e', sourceOrganization: 'USDA FSIS', sourceUrl: 'https://www.fsis.usda.gov/...', jurisdiction: 'US (example rule)', lastVerified: '2024-06-01',
    trigger: { floodExposure: false, powerOutage: true, generatorPresent: false },
    appliesTo: { categories: ['Frozen','Meat'], storageTypes: ['Frozen'] }, active: true },
  { ruleCode: 'FS-GEN-01', condition: 'c', action: 'a', priority: 'Medium', explanation: 'e', sourceOrganization: 'RAKSHA prototype default', sourceUrl: '', jurisdiction: 'Community', lastVerified: '',
    trigger: { floodExposure: false, powerOutage: true, generatorPresent: true }, active: true }
]);

const MAIN = { disasterType: 'flood+outage', durationHours: 24, internetOff: true, floodExposure: true, ambientTempC: 32 };
const run = (cfg, opts = {}) => runSimulation(
  community,
  { ...cfg },
  opts.foods || baseFoods(),
  opts.resources ?? baseResources(),
  opts.rules ?? baseRules()
);
/* ── 1. No disaster ── */
describe('1 · No disaster (power ON, no flood)', () => {
  it('gap 0, all units grid-powered and protected, no capacity gap', () => {
    const { baselineResult: r } = run({ disasterType: 'flood', durationHours: 24, internetOff: false, floodExposure: false, ambientTempC: 30 });
    assert.equal(r.totals.gapKg, 0);
    assert.equal(r.capacityGap, 0);
    assert.ok(r.resourceUtilization.every(u => u.poweredBy === 'Grid' && u.protected));
    assert.ok(!r.preparednessGaps.some(g => g.code === 'GAP-CAP-01'));
  });
  it('no active rules -> default ladder (Milk PRIORITY, no rule cited)', () => {
    const { baselineResult: r } = run({ disasterType: 'flood', durationHours: 24, internetOff: false, floodExposure: false, ambientTempC: 30 });
    const milk = r.foodEvaluated.find(f => f.name === 'Milk');
    assert.equal(milk.status, 'PRIORITY');
    assert.equal(milk.guidance.ruleCode, null);
  });
});

/* ── 2. Power outage 12 h ── */
describe('2 · Power outage 12 h', () => {
  it('retained cold keeps every unit eligible -> gap 0 (produce not in queue without flood)', () => {
    const { baselineResult: r } = run({ disasterType: 'outage', durationHours: 12, internetOff: false, floodExposure: false, ambientTempC: 30 });
    assert.equal(r.requiredCapacity, 100);
    assert.equal(r.protectedCapacity, 160);
    assert.equal(r.capacityGap, 0);
    assert.equal(r.totals.gapKg, 0);
    assert.ok(r.resourceUtilization.every(u => u.protected));
  });
});

/* ── 3. Flood only (power ON) ── */
describe('3 · Flood only (power ON)', () => {
  it('produce requires protection under flood rule; all units grid-protected; gap 0', () => {
    const { baselineResult: r } = run({ disasterType: 'flood', durationHours: 24, internetOff: false, floodExposure: true, ambientTempC: 32 });
    assert.equal(r.requiredCapacity, 140);
    assert.equal(r.protectedCapacity, 160);
    assert.equal(r.totals.gapKg, 0);
    const veg = r.foodEvaluated.find(f => f.name === 'Fresh vegetables');
    assert.equal(veg.status, 'PROTECT');            // default ladder
    assert.equal(veg.guidance.ruleCode, 'FS-FLOOD-01'); // guidance cites the contamination rule
  });
});

/* ── 4. Flood + power outage 24 h (main demo scenario) ── */
describe('4 · Flood + 24 h power outage @ 32 C', () => {
  it('baseline gap 50 kg, optimized 30 kg, structural capacity gap 30 kg', () => {
    const { baselineResult: b, optimizedResult: o } = run(MAIN);
    assert.equal(b.requiredCapacity, 140);
    assert.equal(b.protectedCapacity, 110);   // FridgeA 50 + Freezer 40 + Cold box 20 (FridgeB excluded)
    assert.equal(b.capacityGap, 30);
    assert.equal(b.totals.protectedKg, 90);
    assert.equal(b.totals.gapKg, 50);
    assert.equal(o.totals.protectedKg, 110);
    assert.equal(o.totals.gapKg, 30);
  });
  it('REGRESSION: no unit is allocated beyond its capacity (over-allocation bug)', () => {
    const { baselineResult: b, optimizedResult: o } = run(MAIN);
    for (const r of [b, o]) {
      for (const a of r.allocations) {
        if (a.capacityKg > 0) {
          assert.ok(a.allocatedKg <= a.capacityKg,
            `${a.resource}: allocated ${a.allocatedKg} kg > capacity ${a.capacityKg} kg`);
        }
      }
    }
  });
  it('critical food = rule-classified items (Cooked + Milk, 50 kg / 2 items) with rule metadata', () => {
    const { baselineResult: r } = run(MAIN);
    assert.equal(r.criticalFood.length, 2);
    assert.equal(r.totals.criticalKg, 50);
    const milk = r.criticalFood.find(f => f.name === 'Milk');
    assert.equal(milk.guidance.ruleCode, 'FS-REFR-02');
    assert.equal(milk.guidance.sourceOrganization, 'USDA FSIS');
  });
  it('contamination rule does NOT classify non-exposed food (all-CRITICAL bug)', () => {
    const { baselineResult: r } = run(MAIN);
    const rice = r.foodEvaluated.find(f => f.name === 'Rice & grains');
    const veg = r.foodEvaluated.find(f => f.name === 'Fresh vegetables');
    assert.equal(rice.status, 'STABLE');   // untouched food stays on the default ladder
    assert.equal(veg.status, 'PROTECT');
    assert.equal(r.foodEvaluated.filter(f => f.status === 'CRITICAL').length, 2); // only Cooked + Milk
  });
  it('preparedness index 56 baseline -> 60 optimized, with disclaimer', () => {
    const { baselineResult: b, optimizedResult: o } = run(MAIN);
    assert.equal(b.preparednessScore.score, 56);
    assert.equal(o.preparednessScore.score, 60);
    assert.ok(b.preparednessScore.disclaimer.includes('Prototype preparedness index'));
  });
  it('recommendations use P0/P1/P2 tiers and cite rules', () => {
    const { baselineResult: r } = run(MAIN);
    assert.ok(r.recommendations.some(a => a.tier === 'P1'));
    assert.ok(r.recommendations.some(a => a.tier === 'P1' && a.rule && a.rule.ruleCode === 'FS-GEN-01'));
    assert.ok(r.recommendations.every(a => ['P0','P1','P2'].includes(a.tier)));
  });
});

/* ── 5. Storage capacity sufficient ── */
describe('5 · Capacity sufficient', () => {
  it('no GAP-CAP-01 when eligible capacity covers the requirement', () => {
    const { baselineResult: r } = run({ disasterType: 'outage', durationHours: 12, internetOff: false, floodExposure: false, ambientTempC: 30 });
    assert.equal(r.capacityGap, 0);
    assert.ok(!r.preparednessGaps.some(g => g.code === 'GAP-CAP-01'));
  });
});

/* ── 6. Storage capacity insufficient ── */
describe('6 · Capacity insufficient', () => {
  it('GAP-CAP-01 created with the structural shortfall', () => {
    const resources = baseResources().filter(r => !['Refrigerator B', 'Freezer'].includes(r.name));
    const { baselineResult: r } = run(MAIN, { resources });
    assert.equal(r.protectedCapacity, 70);   // FridgeA 50 + Cold box 20
    assert.equal(r.capacityGap, 70);
    const gap = r.preparednessGaps.find(g => g.code === 'GAP-CAP-01');
    assert.ok(gap && gap.severity === 'HIGH');
    assert.ok(gap.detail.includes('70 kg'));
  });
});

/* ── 7. No resources available ── */
describe('7 · No resources at all', () => {
  it('everything requiring protection is unprotected; gap equals requirement', () => {
    const { baselineResult: r } = run(MAIN, { resources: [] });
    assert.equal(r.requiredCapacity, 140);
    assert.equal(r.protectedCapacity, 0);
    assert.equal(r.capacityGap, 140);
    assert.equal(r.totals.protectedKg, 0);
    assert.equal(r.totals.gapKg, 140);
    assert.ok(r.recommendations.some(a => /additional cold storage/i.test(a.title)));
  });
});

/* ── 8. Flood-exposed food ── */
describe('8 · Flood-exposed food item', () => {
  it('exposed item is UNSAFE, carries full rule metadata, excluded from allocation', () => {
    const foods = baseFoods();
    foods[1].floodExposure = true;   // Milk touched flood water
    const { baselineResult: r } = run(MAIN, { foods });
    const milk = r.foodEvaluated.find(f => f.name === 'Milk');
    assert.equal(milk.status, 'UNSAFE');
    assert.equal(milk.guidance.ruleCode, 'FS-FLOOD-01');
    assert.equal(milk.guidance.sourceOrganization, 'U.S. FDA');
    assert.equal(milk.guidance.sourceUrl, 'https://www.fda.gov/...');
    assert.equal(milk.guidance.jurisdiction, 'US (example rule)');
    assert.equal(milk.allocatedToStorage, false);
    assert.equal(r.requiredCapacity, 120);   // 140 - 20 (milk removed from queue)
    assert.ok(r.preparednessGaps.some(g => g.code === 'GAP-CONTAM-01'));
    assert.ok(r.recommendations.some(a => a.tier === 'P0' && /Separate flood-exposed/i.test(a.title)));
  });
});

/* ── 9. Offline simulation data ── */
describe('9 · Offline simulation data (IndexedDB caching contract)', () => {
  it('result survives a JSON round-trip with all required fields intact', () => {
    const { baselineResult: r } = run(MAIN);
    const cached = JSON.parse(JSON.stringify(r));   // what the frontend caches offline
    for (const key of ['scenario','foodEvaluated','criticalFood','priorityFood','protectedFood','unprotectedFood',
      'requiredCapacity','protectedCapacity','capacityGap','resourceUtilization','allocations',
      'preparednessGaps','recommendations','preparednessScore']) {
      assert.ok(key in cached, `missing ${key} after round-trip`);
    }
    assert.equal(cached.capacityGap, 30);
    assert.equal(cached.preparednessScore.score, 56);
    assert.ok(cached.foodEvaluated[0].guidance.ruleCode !== undefined);
  });
});

/* ── 10. Rule configurability (rules are data) ── */
describe('10 · Rules are configurable data', () => {
  it('deactivating FS-REFR-02 changes Milk from CRITICAL to default-ladder PRIORITY', () => {
    const rules = baseRules().filter(r => r.ruleCode !== 'FS-REFR-02');
    const { baselineResult: r } = run(MAIN, { rules });
    const milk = r.foodEvaluated.find(f => f.name === 'Milk');
    assert.equal(milk.status, 'PRIORITY');
    assert.equal(milk.guidance.ruleCode, null);
  });
});