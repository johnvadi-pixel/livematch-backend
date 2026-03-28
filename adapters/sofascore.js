/**
 * adapters/sofascore.js
 * Usa los endpoints públicos no documentados de SofaScore.
 * No requiere API key — solo headers correctos de navegador.
 *
 * IMPORTANTE: Usar SOLO desde el backend (servidor), nunca
 * desde el navegador del usuario (CORS bloqueado en cliente).
 *
 * Fuente más actualizada: refresca cada 15s en partidos en vivo.
 * Cubre prácticamente todas las ligas del mundo + selecciones.
 */

const axios = require('axios');

const BASE = 'https://api.sofascore.com/api/v1';

// Headers que imitan a un navegador real
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': 'https://www.sofascore.com/',
  'Origin': 'https://www.sofascore.com',
  'Cache-Control': 'no-cache',
};

const client = axios.create({
  baseURL: BASE,
  headers: HEADERS,
  timeout: 12000,
});

/**
 * Lista de todos los partidos de fútbol en vivo ahora mismo
 * Retorna array normalizado con id, equipos, marcador, minuto
 */
async function getLiveMatches() {
  try {
    const { data } = await client.get('/sport/football/events/live');
    return (data.events || []).map(normalizeEvent);
  } catch (err) {
    handleError('getLiveMatches', err);
    return [];
  }
}

/**
 * Partidos programados para hoy (fecha formato YYYY-MM-DD)
 */
async function getMatchesByDate(dateStr) {
  // dateStr = '2024-03-10'
  try {
    const { data } = await client.get(`/sport/football/scheduled-events/${dateStr}`);
    return (data.events || []).map(normalizeEvent);
  } catch (err) {
    handleError('getMatchesByDate', err);
    return [];
  }
}

/**
 * Incidencias en tiempo real de un partido específico
 * Devuelve: goles, tarjetas, sustituciones, corners, penales
 */
async function getMatchIncidents(eventId) {
  try {
    const { data } = await client.get(`/event/${eventId}/incidents`);
    return (data.incidents || []).map(normalizeIncident);
  } catch (err) {
    handleError('getMatchIncidents', err);
    return [];
  }
}

/**
 * Estadísticas detalladas del partido
 * Posesión, tiros, pases, faltas, etc.
 */
async function getMatchStatistics(eventId) {
  try {
    const { data } = await client.get(`/event/${eventId}/statistics`);
    const period = data.statistics?.find(s => s.period === 'ALL') || data.statistics?.[0];
    return (period?.groups || []).flatMap(g =>
      (g.statisticsItems || []).map(item => ({
        label: item.name,
        home: item.home,
        away: item.away,
        homeValue: item.homeValue,
        awayValue: item.awayValue,
      }))
    );
  } catch (err) {
    handleError('getMatchStatistics', err);
    return [];
  }
}

/**
 * Alineaciones de ambos equipos con posiciones en campo
 * Retorna formación (ej: "4-3-3") y array de jugadores con coords
 */
async function getMatchLineups(eventId) {
  try {
    const { data } = await client.get(`/event/${eventId}/lineups`);
    return {
      home: normalizeLineup(data.home),
      away: normalizeLineup(data.away),
    };
  } catch (err) {
    handleError('getMatchLineups', err);
    return { home: null, away: null };
  }
}

/**
 * Últimos N partidos de un equipo (head to head previo)
 */
async function getH2H(eventId) {
  try {
    const { data } = await client.get(`/event/${eventId}/h2h`);
    const events = data?.events || data?.previousEvents || [];
    return events.slice(0, 5).map(normalizeEvent);
  } catch (err) {
    handleError('getH2H', err);
    return [];
  }
}

/**
 * Busca partidos o equipos por texto libre
 */
async function search(query) {
  try {
    const { data } = await client.get('/search/multi-search', {
      params: { q: query },
    });
    // Filtra solo eventos (partidos)
    const events = data.results?.filter(r => r.type === 'event') || [];
    return events.map(r => normalizeEvent(r.entity));
  } catch (err) {
    handleError('search', err);
    return [];
  }
}

// ── Normalizadores ────────────────────────────────────────────────

function normalizeEvent(e) {
  if (!e) return null;
  const statusMap = {
    notstarted: 'SCHEDULED',
    inprogress: 'IN_PLAY',
    halftime:   'PAUSED',
    finished:   'FINISHED',
    postponed:  'POSTPONED',
    canceled:   'CANCELED',
  };

  return {
    id: e.id,
    source: 'sofascore',
    competition: e.tournament?.name || e.season?.tournament?.name || '',
    competitionId: e.tournament?.id,
    homeTeam: {
      id: e.homeTeam?.id,
      name: e.homeTeam?.shortName || e.homeTeam?.name || '',
      colors: e.homeTeam?.teamColors || null,
    },
    awayTeam: {
      id: e.awayTeam?.id,
      name: e.awayTeam?.shortName || e.awayTeam?.name || '',
      colors: e.awayTeam?.teamColors || null,
    },
    score: {
      home: e.homeScore?.current ?? null,
      away: e.awayScore?.current ?? null,
    },
    status: statusMap[e.status?.type] || e.status?.type || 'UNKNOWN',
    minute: e.time?.currentPeriodStartTimestamp
      ? Math.floor((Date.now() / 1000 - e.time.currentPeriodStartTimestamp) / 60)
      : null,
    startTimestamp: e.startTimestamp,
  };
}

function normalizeIncident(inc) {
  // Mapeo de tipos de incidencia de SofaScore a tipos internos
  const typeMap = {
    goal:          'gol',
    ownGoal:       'gol-en-contra',
    yellowCard:    'tarjeta-amarilla',
    redCard:       'tarjeta-roja',
    yellowRedCard: 'tarjeta-roja',
    substitution:  'cambio',
    varDecision:   'var',
    missedPenalty: 'penal-fallado',
    penalty:       'gol',           // penales que entran
  };

  return {
    id: inc.id,
    type: typeMap[inc.incidentType] || inc.incidentType || 'otro',
    minute: inc.time,
    minuteExtra: inc.addedTime || null,
    team: inc.isHome ? 'home' : 'away',
    player: inc.player?.shortName || inc.player?.name || '',
    assist: inc.playerIn?.shortName || inc.assist?.name || null,
    description: inc.description || '',
    // Para sustituciones
    playerOut: inc.playerOut?.shortName || null,
    playerIn: inc.playerIn?.shortName || null,
  };
}

function normalizeLineup(side) {
  if (!side) return null;
  return {
    formation: side.formation || '',
    // Jugadores con posición en campo (x/y de 0-100)
    players: (side.players || []).map(p => ({
      id: p.player?.id,
      name: p.player?.shortName || p.player?.name || '',
      number: p.jerseyNumber,
      position: p.position,     // GK, DF, MF, FW
      coords: {
        x: p.player?.fieldTranslations?.fieldLngShort ?? null,
        y: p.player?.fieldTranslations?.fieldLatShort ?? null,
      },
      captain: p.captain || false,
      substitute: p.substitute || false,
    })),
    colors: {
      primary:    side.playerColor?.primary    || '#ffffff',
      secondary:  side.playerColor?.secondary  || '#000000',
      goalkeeper: side.goalkeeperColor?.primary || '#ffff00',
    },
  };
}

function handleError(fn, err) {
  if (err.response) {
    if (err.response.status === 403) {
      console.warn(`[sofascore] ${fn}: bloqueado (403). SofaScore puede haber cambiado sus headers.`);
    } else if (err.response.status === 429) {
      console.warn(`[sofascore] ${fn}: demasiadas solicitudes (429). Reducir frecuencia.`);
    } else {
      console.error(`[sofascore] ${fn}: HTTP ${err.response.status}`);
    }
  } else {
    console.error(`[sofascore] ${fn}: ${err.message}`);
  }
}

/**
 * Mejores jugadores del partido (post-partido)
 */
async function getBestPlayers(eventId) {
  try {
    const { data } = await client.get(`/event/${eventId}/best-players`);
    const home = (data.homeTeam?.players || []).slice(0, 3).map(p => ({
      name: p.player?.shortName || p.player?.name || '',
      rating: p.statistics?.rating?.toFixed(1) || null,
      goals: p.statistics?.goals || 0,
      assists: p.statistics?.goalAssist || 0,
      position: p.player?.position || '',
      teamSide: 'home',
    }));
    const away = (data.awayTeam?.players || []).slice(0, 3).map(p => ({
      name: p.player?.shortName || p.player?.name || '',
      rating: p.statistics?.rating?.toFixed(1) || null,
      goals: p.statistics?.goals || 0,
      assists: p.statistics?.goalAssist || 0,
      position: p.player?.position || '',
      teamSide: 'away',
    }));
    const playerOfMatch = data.playerOfMatch ? {
      name: data.playerOfMatch?.player?.shortName || data.playerOfMatch?.player?.name || '',
      rating: data.playerOfMatch?.statistics?.rating?.toFixed(1) || null,
      teamSide: data.playerOfMatch?.isHomeTeam ? 'home' : 'away',
    } : null;
    return { home, away, playerOfMatch };
  } catch (err) {
    handleError('getBestPlayers', err);
    return { home: [], away: [], playerOfMatch: null };
  }
}

/**
 * Tabla de posiciones del torneo
 */
async function getStandings(tournamentId, seasonId) {
  try {
    const { data } = await client.get(`/unique-tournament/${tournamentId}/season/${seasonId}/standings/total`);
    const rows = data.standings?.[0]?.rows || [];
    return rows.map(r => ({
      position: r.position,
      team: r.team?.shortName || r.team?.name || '',
      teamId: r.team?.id,
      played: r.matches,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      goalsFor: r.scoresFor,
      goalsAgainst: r.scoresAgainst,
      points: r.points,
      form: r.promotion?.text || null,
    }));
  } catch (err) {
    handleError('getStandings', err);
    return [];
  }
}

/**
 * Eventos/goles del partido (resumen post-partido)
 */
async function getMatchEvents(eventId) {
  try {
    const { data } = await client.get(`/event/${eventId}/incidents`);
    const incidents = data.incidents || [];
    // Filtrar solo goles, tarjetas y sustituciones
    const typeMap = {
      goal: 'gol', ownGoal: 'gol-en-contra',
      yellowCard: 'tarjeta-amarilla', redCard: 'tarjeta-roja',
      yellowRedCard: 'tarjeta-roja', substitution: 'cambio',
      varDecision: 'var', missedPenalty: 'penal-fallado',
    };
    return incidents
      .filter(inc => typeMap[inc.incidentType])
      .map(inc => ({
        type: typeMap[inc.incidentType] || inc.incidentType,
        minute: inc.time,
        minuteExtra: inc.addedTime || null,
        team: inc.isHome ? 'home' : 'away',
        player: inc.player?.shortName || inc.player?.name || '',
        assist: inc.playerIn?.shortName || inc.assist?.name || null,
        description: inc.description || '',
      }));
  } catch (err) {
    handleError('getMatchEvents', err);
    return [];
  }
}

module.exports = {
  getLiveMatches,
  getMatchesByDate,
  getMatchIncidents,
  getMatchStatistics,
  getMatchLineups,
  getH2H,
  search,
  getBestPlayers,
  getStandings,
  getMatchEvents,
};
