/**
 * RAKSHA — Storage Capacity Engine
 * --------------------------------
 * Determines which cold-chain resources keep protecting food under the
 * scenario, and computes the capacity picture:
 *
 *   requiredCapacity  = sum(quantity of food requiring protection)
 *   protectedCapacity = sum(eligible available storage capacity)  [supported units]
 *   capacityGap       = max(0, requiredCapacity - protectedCapacity)
 *
 * EQUIPMENT_PARAMETERS are clearly-labeled PROTOTYPE EQUIPMENT ASSUMPTIONS
 * (how long ice keeps a cold box cold, how long a closed unpowered appliance
 * retains coolness). They are NOT food-safety thresholds — the authoritative
 * food-safety wording lives in the configured rules (e.g. FS-FRZ-01).
 * Replace these values with community-configured data in production.
 */

const COLD_TYPES = ['Refrigerator', 'Freezer', 'Cold box'];

const EQUIPMENT_PARAMETERS = {
  ICE_LASTS_HOURS: 24,          // ice keeps a cold box cold ≈ 24 h (prototype assumption)
  ICE_LASTS_HOURS_HOT: 12,      // …only ≈ 12 h in hot ambient conditions
  HOT_AMBIENT_THRESHOLD_C: 35,  // "hot" ambient (prototype assumption)
  RETAINED_COLD_HOURS: 12,      // closed unpowered cold appliance retains coolness ≈ 12 h
  ICE_MIN_KG: 10                // minimum ice to keep a cold box going
};

// Power-security ranking (higher = more robust under outage scenarios)
const POWER_SECURITY = { Generator: 4, Grid: 3, Ice: 2, Retained: 1, None: 0 };

function assessSupport(resources, scenario) {
  const powerOff = scenario.powerOff;
  const hasGenerator = resources.some(r => r.type === 'Generator' && r.operational);
  const iceRes = resources.find(r => r.type === 'Ice supply');
  const iceKg = iceRes && iceRes.unit === 'kg' ? iceRes.capacity : 0;
  const iceLasts = scenario.ambientTempC >= EQUIPMENT_PARAMETERS.HOT_AMBIENT_THRESHOLD_C
    ? EQUIPMENT_PARAMETERS.ICE_LASTS_HOURS_HOT
    : EQUIPMENT_PARAMETERS.ICE_LASTS_HOURS;

  const units = resources
    .filter(r => COLD_TYPES.includes(r.type) && r.unit === 'kg' && r.operational) // operational only
    .map(r => {
      let supported, poweredBy;
      if (!powerOff) { supported = true; poweredBy = 'Grid'; }
      else if (hasGenerator && r.poweredByGenerator) { supported = true; poweredBy = 'Generator'; }
      else if (r.type === 'Cold box') {
        supported = iceKg >= EQUIPMENT_PARAMETERS.ICE_MIN_KG && scenario.durationHours <= iceLasts;
        poweredBy = supported ? 'Ice' : 'None — unpowered';
      } else if (scenario.durationHours <= EQUIPMENT_PARAMETERS.RETAINED_COLD_HOURS) {
        supported = true; poweredBy = 'Retained cold (closed door)';
      } else { supported = false; poweredBy = 'None — unpowered'; }

      return {
        id: String(r._id),
        name: r.name,
        type: r.type,
        capacityKg: r.capacity,
        poweredByGenerator: !!r.poweredByGenerator,
        operational: true,
        operationalStatus: r.operationalStatus || 'Operational',
        supported,
        poweredBy,
        powerSecurity: POWER_SECURITY[poweredBy.split(' ')[0]] ?? POWER_SECURITY.None
      };
    });

  return {
    units,
    hasGenerator,
    iceKg,
    support: {
      generator: {
        present: hasGenerator,
        note: hasGenerator
          ? 'Supports generator-circuit appliances · fuel on hand ≈ 8 h (placeholder assumption)'
          : 'No backup power resource configured'
      },
      ice: { kg: iceKg, note: iceKg > 0 ? `${iceKg} kg in stock — covers the cold box` : 'No ice stock configured' }
    }
  };
}

// The capacity picture for a protection queue.
function computeCapacities(units, queue) {
  const requiredCapacity = queue.reduce((s, f) => s + f.quantity, 0);
  const protectedCapacity = units.filter(u => u.supported)
    .reduce((s, u) => s + u.capacityKg, 0);
  const capacityGap = Math.max(0, requiredCapacity - protectedCapacity);
  return { requiredCapacity, protectedCapacity, capacityGap };
}

module.exports = { assessSupport, computeCapacities, COLD_TYPES, EQUIPMENT_PARAMETERS };