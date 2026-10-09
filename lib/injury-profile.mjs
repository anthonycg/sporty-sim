const STATUS_ASSUMPTIONS = Object.freeze({
  out: { playProbability: 0, limitedProbability: 0 },
  inactive: { playProbability: 0, limitedProbability: 0 },
  ir: { playProbability: 0, limitedProbability: 0 },
  doubtful: { playProbability: 20, limitedProbability: 15 },
  questionable: { playProbability: 60, limitedProbability: 25 },
  probable: { playProbability: 90, limitedProbability: 20 },
  limited: { playProbability: 80, limitedProbability: 35 },
  daytoday: { playProbability: 65, limitedProbability: 30 }
});

const POSITION_GROUPS = Object.freeze({
  QB: { unit: 'offense', unitGroup: 'quarterback', starterImpact: 6, starterSnaps: 100 },
  RB: { unit: 'offense', unitGroup: 'skill', starterImpact: 1.35, starterSnaps: 70 },
  FB: { unit: 'offense', unitGroup: 'skill', starterImpact: 0.55, starterSnaps: 45 },
  WR: { unit: 'offense', unitGroup: 'skill', starterImpact: 1.5, starterSnaps: 80 },
  TE: { unit: 'offense', unitGroup: 'skill', starterImpact: 1.1, starterSnaps: 75 },
  OT: { unit: 'offense', unitGroup: 'offensive-line', starterImpact: 1.3, starterSnaps: 100 },
  T: { unit: 'offense', unitGroup: 'offensive-line', starterImpact: 1.3, starterSnaps: 100 },
  G: { unit: 'offense', unitGroup: 'offensive-line', starterImpact: 1.1, starterSnaps: 100 },
  OG: { unit: 'offense', unitGroup: 'offensive-line', starterImpact: 1.1, starterSnaps: 100 },
  C: { unit: 'offense', unitGroup: 'offensive-line', starterImpact: 1.15, starterSnaps: 100 },
  DE: { unit: 'defense', unitGroup: 'front-seven', starterImpact: 1.05, starterSnaps: 75 },
  DT: { unit: 'defense', unitGroup: 'front-seven', starterImpact: 0.95, starterSnaps: 70 },
  NT: { unit: 'defense', unitGroup: 'front-seven', starterImpact: 0.9, starterSnaps: 65 },
  DL: { unit: 'defense', unitGroup: 'front-seven', starterImpact: 0.95, starterSnaps: 70 },
  LB: { unit: 'defense', unitGroup: 'front-seven', starterImpact: 1, starterSnaps: 80 },
  OLB: { unit: 'defense', unitGroup: 'front-seven', starterImpact: 1.05, starterSnaps: 80 },
  ILB: { unit: 'defense', unitGroup: 'front-seven', starterImpact: 1, starterSnaps: 80 },
  CB: { unit: 'defense', unitGroup: 'secondary', starterImpact: 1.2, starterSnaps: 90 },
  DB: { unit: 'defense', unitGroup: 'secondary', starterImpact: 1, starterSnaps: 80 },
  S: { unit: 'defense', unitGroup: 'secondary', starterImpact: 1.15, starterSnaps: 90 },
  FS: { unit: 'defense', unitGroup: 'secondary', starterImpact: 1.15, starterSnaps: 90 },
  SS: { unit: 'defense', unitGroup: 'secondary', starterImpact: 1.15, starterSnaps: 90 },
  K: { unit: 'offense', unitGroup: 'special-teams', starterImpact: 0.65, starterSnaps: 100 },
  P: { unit: 'offense', unitGroup: 'special-teams', starterImpact: 0.4, starterSnaps: 100 }
});

function normalizedStatus(injury) {
  const values = [
    injury.status,
    injury.type?.description,
    injury.type?.name,
    injury.type?.abbreviation,
    injury.details?.fantasyStatus?.displayDescription,
    injury.details?.fantasyStatus?.description
  ].filter(Boolean).join(' ').toLowerCase();
  if (/\binactive\b/.test(values)) return 'inactive';
  if (/injured reserve|\bir\b/.test(values)) return 'ir';
  if (/\bout\b/.test(values)) return 'out';
  if (/doubtful/.test(values)) return 'doubtful';
  if (/questionable/.test(values)) return 'questionable';
  if (/probable/.test(values)) return 'probable';
  if (/day.to.day/.test(values)) return 'daytoday';
  if (/limited/.test(values)) return 'limited';
  return null;
}

function depthIndex(depthchart = []) {
  const athletes = new Map();
  for (const formation of depthchart || []) {
    for (const [slot, position] of Object.entries(formation.positions || {})) {
      const lineup = position.athletes || [];
      lineup.forEach((athlete, index) => {
        const id = String(athlete.id || '');
        if (!id) return;
        const existing = athletes.get(id);
        if (existing && existing.depth <= index) return;
        athletes.set(id, {
          depth: index,
          slot,
          replacement: index === 0 ? lineup[1]?.displayName || null : null
        });
      });
    }
  }
  return athletes;
}

function roleAssumptions(position, depth) {
  const definition = POSITION_GROUPS[position] || {
    unit: 'offense', unitGroup: 'skill', starterImpact: 0.6, starterSnaps: 50
  };
  if (depth === 0) return { ...definition, depthRole: 'starter' };
  if (depth === 1) return {
    ...definition,
    starterImpact: Math.max(0.25, definition.starterImpact * 0.38),
    starterSnaps: Math.min(45, definition.starterSnaps),
    depthRole: 'rotation'
  };
  return {
    ...definition,
    starterImpact: Math.max(0.15, definition.starterImpact * 0.18),
    starterSnaps: Math.min(25, definition.starterSnaps),
    depthRole: Number.isFinite(depth) ? 'depth' : 'unverified depth'
  };
}

export function buildAvailabilityPlayers(injuryGroups = [], depthCharts = {}) {
  const players = [];
  for (const group of injuryGroups || []) {
    const teamId = String(group.team?.id || '');
    const depths = depthIndex(depthCharts[teamId]?.depthchart || depthCharts[teamId] || []);
    for (const injury of group.injuries || []) {
      const statusKey = normalizedStatus(injury);
      if (!statusKey) continue;
      const athleteId = String(injury.athlete?.id || '');
      const position = String(injury.athlete?.position?.abbreviation || '').toUpperCase();
      const depth = depths.get(athleteId) || { depth: Number.POSITIVE_INFINITY, slot: null, replacement: null };
      const role = roleAssumptions(position, depth.depth);
      const availability = STATUS_ASSUMPTIONS[statusKey];
      players.push({
        id: `automatic-${teamId}-${athleteId || players.length}`,
        athleteId,
        teamId,
        name: injury.athlete?.displayName || injury.athlete?.fullName || 'Listed player',
        position: position || '—',
        unit: role.unit,
        unitGroup: role.unitGroup,
        playProbability: availability.playProbability,
        limitedProbability: availability.limitedProbability,
        pointsImpact: Number(role.starterImpact.toFixed(2)),
        limitedImpact: 40,
        snapShare: role.starterSnaps,
        status: statusKey === 'daytoday' ? 'Day-to-day' : statusKey[0].toUpperCase() + statusKey.slice(1),
        injury: injury.details?.type || injury.details?.detail || '',
        depthRole: role.depthRole,
        depthSlot: depth.slot,
        replacement: depth.replacement,
        source: 'automatic'
      });
    }
  }
  return players.sort((first, second) => {
    const statusDifference = first.playProbability - second.playProbability;
    if (statusDifference) return statusDifference;
    return second.pointsImpact * second.snapShare - first.pointsImpact * first.snapShare;
  });
}

