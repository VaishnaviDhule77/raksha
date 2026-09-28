/**
 * RAKSHA — Resource Matcher (allocation engine)
 * ---------------------------------------------
 * Two strategies:
 *
 * baseline  — "as stored today": each food prefers its recorded unit
 *             (storedAt), then first-fit in recorded order. Deliberately
 *             naive — it models current luck, not planning.
 *
 * optimized — protection-aware ranked allocation. Candidates are ranked by:
 *               1. can operate under the scenario (supported)   [power availability]
 *               2. power security (Generator > Grid > Ice > Retained)
 *               3. compatibility affinity (frozen->freezer, refrigerated->fridge,
 *                  produce->cold box)
 *               4. available capacity (larger free capacity first)
 *               5. distance (only when location coordinates exist — inert otherwise)
 *             Protected units are filled first; overflow goes to unprotected
 *             units only afterwards (better than nothing).
 *
 * INVARIANT: a unit never receives more food than its capacity.
 * (candidateOrder sorts REFERENCES to the live units — never copies — so
 * capacity accounting stays correct across successive allocations.)
 */

function initUnits(units) {
  return units.map(u => ({ ...u, free: u.capacityKg, items: [] }));
}

function take(u, food, qty) {
  const amount = Math.min(u.free, qty);   // hard capacity cap
  if (amount > 0) {
    u.free -= amount;
    u.items.push({ food: food.name, qty: amount });
  }
  return amount;
}

function affinity(food, u) {
  let s = 0;
  if (food.category === 'Frozen' && u.type === 'Freezer') s -= 4;
  if (food.storageType === 'Refrigerated' && u.type === 'Refrigerator') s -= 4;
  if (['Vegetables', 'Fruits'].includes(food.category) && u.type === 'Cold box') s -= 2;
  if (u.type === 'Freezer') s += 1; // freezers are a last resort for non-frozen food
  return s;
}

// Haversine distance (km) — used for ranking ONLY when both sides have
// coordinates. Seed data has none, so this stays inert until geo data exists.
function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Sorts the ORIGINAL unit references (mutating sort of a sliced array) so that
// take() updates the live free capacity. Distances are computed separately and
// only used inside the comparator.
function candidateOrder(food, units, origin) {
  const dist = new Map();
  for (const u of units) {
    dist.set(u, origin && u.geo ? distanceKm(origin, u.geo) : null);
  }
  return units.slice().sort((a, b) => {
    if (a.supported !== b.supported) return a.supported ? -1 : 1;                    // 1. operates under scenario
    if (a.powerSecurity !== b.powerSecurity) return b.powerSecurity - a.powerSecurity; // 2. power security
    const af = affinity(food, a), bf = affinity(food, b);
    if (af !== bf) return af - bf;                                                   // 3. compatibility
    if (b.free !== a.free) return b.free - a.free;                                   // 4. available capacity
    const ad = dist.get(a) == null ? Infinity : dist.get(a);
    const bd = dist.get(b) == null ? Infinity : dist.get(b);
    return ad - bd;                                                                  // 5. distance (if data exists)
  });
}

function fillRanked(food, units, remaining, origin) {
  for (const u of candidateOrder(food, units, origin)) {
    if (remaining <= 0) break;
    if (u.free <= 0) continue;
    remaining -= take(u, food, remaining);
  }
  return remaining;
}

function baselineAllocation(queue, units) {
  const state = initUnits(units);
  const byId = new Map(state.map(u => [u.id, u]));
  const unplaced = [];
  for (const f of queue) {
    let remaining = f.quantity;
    const order = [];
    if (f.storedAt && byId.has(f.storedAt)) order.push(byId.get(f.storedAt)); // recorded unit first
    for (const u of state) if (!order.includes(u)) order.push(u);
    for (const u of order) {
      if (remaining <= 0) break;
      remaining -= take(u, f, remaining);
    }
    if (remaining > 0) unplaced.push({ food: f.name, qty: remaining });
  }
  return { state, unplaced };
}

function optimizedAllocation(queue, units, origin) {
  const state = initUnits(units);
  const supported = state.filter(u => u.supported);
  const rest = state.filter(u => !u.supported);

  // Pass 1 — protected units only, ranked per food.
  const left = new Map();
  for (const f of queue) left.set(f, fillRanked(f, supported, f.quantity, origin));
  // Pass 2 — overflow into unprotected units (better than nothing).
  const unplaced = [];
  for (const f of queue) {
    let remaining = left.get(f) || 0;
    if (remaining > 0) remaining = fillRanked(f, rest, remaining, origin);
    if (remaining > 0) unplaced.push({ food: f.name, qty: remaining });
  }
  return { state, unplaced };
}

function summarize(state, unplaced) {
  let protectedKg = 0, unprotectedPlacedKg = 0;
  const protectedFood = [], unprotectedFood = [];
  for (const u of state) {
    for (const i of u.items) {
      const entry = { name: i.food, qty: i.qty, unit: 'kg', resource: u.name };
      if (u.supported) { protectedKg += i.qty; protectedFood.push(entry); }
      else { unprotectedPlacedKg += i.qty; unprotectedFood.push(entry); }
    }
  }
  const unplacedKg = unplaced.reduce((s, i) => s + i.qty, 0);
  for (const i of unplaced) unprotectedFood.push({ name: i.food, qty: i.qty, unit: 'kg', resource: 'UNALLOCATED' });
  return { protectedKg, unprotectedPlacedKg, unplacedKg, protectedFood, unprotectedFood };
}

function allocationTable(state, unplaced, sum) {
  const rows = state.map(u => {
    const allocatedKg = u.items.reduce((s, i) => s + i.qty, 0);
    return {
      resourceId: u.id,
      resource: u.name, type: u.type, capacityKg: u.capacityKg, allocatedKg,
      utilization: u.capacityKg ? Math.round((allocatedKg / u.capacityKg) * 100) : 0,
      protected: u.supported, poweredBy: u.poweredBy, items: u.items
    };
  });
  if (unplaced.length) {
    rows.push({
      resourceId: null,
      resource: 'UNALLOCATED — no capacity left', type: '—', capacityKg: 0,
      allocatedKg: sum.unplacedKg, utilization: 0, protected: false, poweredBy: '—',
      items: unplaced.map(x => ({ food: x.food, qty: x.qty }))
    });
  }
  return rows;
}

module.exports = {
  baselineAllocation,
  optimizedAllocation,
  summarize,
  allocationTable,
  affinity,
  distanceKm
};