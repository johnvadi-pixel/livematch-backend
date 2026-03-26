/**
 * adapters/footballData.js
 * Conecta con la API gratuita de football-data.org
 * Docs: https://www.football-data.org/documentation/quickstart
 *
 * Plan gratuito: ~10 req/min, cubre PL, LaLiga, Champions,
 * Bundesliga, Serie A, Ligue 1, y selecciones (WC, EURO).
 */

const axios = require('axios');

const BASE_URL = 'https://api.football-data.org/v4';

// IDs de competiciones soportadas en el plan gratuito
const COMPETITIONS = {
  PL:  { id: 'PL',  name: 'Premier League' },
  PD:  { id: 'PD',  name: 'LaLiga' },
  CL:  { id: 'CL',  name: 'Champions League' },
  BL1: { id: 'BL1', name: 'Bundesliga' },
  SA:  { id: 'SA',  name: 'Serie A' },
  FL1: { id: 'FL1', name: 'Ligue 1' },
  WC:  { id: 'WC',  name: 'World Cup' },
  EC:  { id: 'EC',  name: 'Eurocopa' },
};

function buildClient(apiKey) {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'X-Auth-Token': apiKey,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
}

/**
 * Obtiene todos los partidos en vivo ahora mismo
 * (status=LIVE cubre los que están en curso)
 */
async function getLiveMatches(apiKey) {
  const client = buildClient(apiKey);
  try {
    const { data } = await client.get('/matches', {
      params: { status: 'LIVE' },
    });
    return (data.matches || []).map(normalizeMatch);
  } catch (err) {
    handleError('getLiveMatches', err);
    return [];
  }
}

/**
 * Obtiene los partidos de HOY (útil para mostrar lista
 * de partidos próximos + en curso + recientes)
 */
async function getTodayMatches(apiKey) {
  const today = new Date().toISOString().split('T')[0];
  const client = buildClient(apiKey);
  try {
    const { data } = await client.get('/matches', {
      params: {
        dateFrom: today,
        dateTo: today,
      },
    });
    return (data.matches || []).map(normalizeMatch);
  } catch (err) {
    handleError('getTodayMatches', err);
    return [];
  }
}

/**
 * Detalle completo de un partido específico
 * Incluye: marcador, estado, minuto, goles, tarjetas
 */
async function getMatchDetail(apiKey, matchId) {
  const client = buildClient(apiKey);
  try {
    const { data } = await client.get(`/matches/${matchId}`);
    return normalizeMatchDetail(data);
  } catch (err) {
    handleError('getMatchDetail', err);
    return null;
  }
}

/**
 * Últimos N enfrentamientos entre dos equipos (head to head)
 */
async function getHeadToHead(apiKey, matchId, limit = 5) {
  const client = buildClient(apiKey);
  try {
    const { data } = await client.get(`/matches/${matchId}/head2head`, {
      params: { limit },
    });
    return (data.matches || []).map(normalizeMatch);
  } catch (err) {
    handleError('getHeadToHead', err);
    return [];
  }
}

/**
 * Tabla de posiciones de una competición
 */
async function getStandings(apiKey, competitionCode) {
  const client = buildClient(apiKey);
  try {
    const { data } = await client.get(`/competitions/${competitionCode}/standings`);
    const table = data?.standings?.find(s => s.type === 'TOTAL');
    return (table?.table || []).map(row => ({
      position: row.position,
      team: row.team.name,
      crestUrl: row.team.crest,
      played: row.playedGames,
      won: row.won,
      draw: row.draw,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      points: row.points,
    }));
  } catch (err) {
    handleError('getStandings', err);
    return [];
  }
}

// ── Normalizadores ────────────────────────────────────────────────

function normalizeMatch(m) {
  return {
    id: m.id,
    source: 'football-data',
    competition: m.competition?.name || '',
    competitionCode: m.competition?.code || '',
    homeTeam: {
      id: m.homeTeam?.id,
      name: m.homeTeam?.shortName || m.homeTeam?.name || '',
      crest: m.homeTeam?.crest || '',
    },
    awayTeam: {
      id: m.awayTeam?.id,
      name: m.awayTeam?.shortName || m.awayTeam?.name || '',
      crest: m.awayTeam?.crest || '',
    },
    score: {
      home: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null,
      away: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null,
    },
    status: m.status,   // SCHEDULED | IN_PLAY | PAUSED | FINISHED
    minute: m.minute || null,
    utcDate: m.utcDate,
  };
}

function normalizeMatchDetail(m) {
  const base = normalizeMatch(m);
  return {
    ...base,
    referees: (m.referees || []).map(r => r.name),
    venue: m.venue || '',
    // Goles del partido
    goals: (m.goals || []).map(g => ({
      minute: g.minute,
      extraTime: g.extraTime || null,
      type: g.type,           // REGULAR | OWN | PENALTY
      team: g.team?.name || '',
      scorer: g.scorer?.name || '',
      assist: g.assist?.name || null,
    })),
    // Tarjetas
    bookings: (m.bookings || []).map(b => ({
      minute: b.minute,
      team: b.team?.name || '',
      player: b.player?.name || '',
      card: b.card,           // YELLOW | RED | YELLOW_RED
    })),
    // Sustituciones
    substitutions: (m.substitutions || []).map(s => ({
      minute: s.minute,
      team: s.team?.name || '',
      playerOut: s.playerOut?.name || '',
      playerIn: s.playerIn?.name || '',
    })),
  };
}

function handleError(fn, err) {
  if (err.response) {
    const status = err.response.status;
    if (status === 429) {
      console.warn(`[football-data] ${fn}: límite de tasa alcanzado (429). Espera 60s.`);
    } else if (status === 403) {
      console.error(`[football-data] ${fn}: API key inválida o competición no disponible en tu plan.`);
    } else {
      console.error(`[football-data] ${fn}: HTTP ${status}`);
    }
  } else {
    console.error(`[football-data] ${fn}: ${err.message}`);
  }
}

module.exports = {
  getLiveMatches,
  getTodayMatches,
  getMatchDetail,
  getHeadToHead,
  getStandings,
  COMPETITIONS,
};
