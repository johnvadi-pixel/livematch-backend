/**
 * services/matchPoller.js
 *
 * Orquesta el polling de datos en tiempo real.
 * - Cada 30s consulta football-data.org (marcadores + eventos oficiales)
 * - Cada 15s consulta SofaScore (incidencias mÃ¡s rÃ¡pidas)
 * - Detecta cambios y emite solo lo nuevo por WebSocket
 * - Mantiene un estado en memoria de todos los partidos activos
 */

const footballData = require('../adapters/footballData');
const sofascore    = require('../adapters/sofascore');
const NodeCache    = require('node-cache');

// Cache con TTL de 2 minutos para no re-procesar datos idÃ©nticos
const cache = new NodeCache({ stdTTL: 120 });

// Estado global en memoria: { [matchId]: matchState }
const matchStates = new Map();

// Suscriptores por partido: { [matchId]: Set<socketId> }
const subscribers = new Map();

let io = null;        // Socket.io server, inyectado desde server.js
let pollTimer = null;
let sofaTimer  = null;

const DEBUG = process.env.DEBUG === 'true';

// ââ InicializaciÃ³n ââââââââââââââââââââââââââââââââââââââââââââââââ

function init(socketIoServer) {
  io = socketIoServer;
  log('MatchPoller iniciado');

  // Primer fetch inmediato
  pollFootballData();
  pollSofaScore();

  // Polling periÃ³dico
  const fdInterval   = parseInt(process.env.POLL_INTERVAL_MS)      || 30000;
  const sfInterval   = parseInt(process.env.SOFASCORE_INTERVAL_MS) || 15000;

  pollTimer  = setInterval(pollFootballData, fdInterval);
  sofaTimer  = setInterval(pollSofaScore, sfInterval);

  log(`Polling football-data cada ${fdInterval/1000}s, SofaScore cada ${sfInterval/1000}s`);
}

function stop() {
  clearInterval(pollTimer);
  clearInterval(sofaTimer);
}

// ââ Polling football-data.org âââââââââââââââââââââââââââââââââââââ

async function pollFootballData() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey || apiKey === 'tu_clave_aqui') {
    log('â  FOOTBALL_DATA_API_KEY no configurada. Usando solo SofaScore.');
    return;
  }

  try {
    const liveMatches = await footballData.getLiveMatches(apiKey);
    log(`football-data: ${liveMatches.length} partidos en vivo`);

    for (const match of liveMatches) {
      await processMatchUpdate(match, 'football-data');
    }

    // Emitir lista completa a todos los clientes en /lobby
    io.to('lobby').emit('live-matches', liveMatches);

  } catch (err) {
    console.error('[poller] pollFootballData error:', err.message);
  }
}

// ââ Polling SofaScore âââââââââââââââââââââââââââââââââââââââââââââ

async function pollSofaScore() {
  try {
    const liveMatches = await sofascore.getLiveMatches();
    log(`sofascore: ${liveMatches.length} partidos en vivo`);

    // Solo actualiza partidos que tienen suscriptores activos
    for (const [matchId, state] of matchStates) {
      if (!hasSubscribers(matchId)) continue;

      // Busca este partido en la lista de SofaScore
      const sfMatch = liveMatches.find(m =>
        String(m.id) === String(state.sofascoreId || matchId)
      );

      if (!sfMatch) continue;

      // Obtener incidencias detalladas
      const incidents = await sofascore.getMatchIncidents(sfMatch.id);
      const newIncidents = detectNewIncidents(matchId, incidents);

      if (newIncidents.length > 0) {
        log(`Nuevas incidencias en partido ${matchId}: ${newIncidents.length}`);
        for (const inc of newIncidents) {
          emitToMatch(matchId, 'incident', inc);
          if (global._procesarIncidente) global._procesarIncidente({ matchId, player: inc.player, incidentType: inc.incidentType, time: inc.time, isLive: true });
          emitToMatch(matchId, 'animation', buildAnimation(inc));
        }
        // Actualizar estado de incidencias
        matchStates.get(matchId).incidents = incidents;
      }

      // Actualizar marcador si cambiÃ³
      const prev = matchStates.get(matchId);
      if (
        prev.score.home !== sfMatch.score.home ||
        prev.score.away !== sfMatch.score.away
      ) {
        prev.score = sfMatch.score;
        emitToMatch(matchId, 'score-update', sfMatch.score);
      }

      // Actualizar minuto
      if (sfMatch.minute) {
        prev.minute = sfMatch.minute;
        emitToMatch(matchId, 'minute', sfMatch.minute);
      }
    }

  } catch (err) {
    console.error('[poller] pollSofaScore error:', err.message);
  }
}

// ââ Procesamiento de actualizaciones âââââââââââââââââââââââââââââ

async function processMatchUpdate(match, source) {
  const id = String(match.id);
  const prev = matchStates.get(id);

  if (!prev) {
    // Partido nuevo â guardar estado inicial
    matchStates.set(id, {
      ...match,
      source,
      incidents: [],
      sofascoreId: null,
      lastUpdated: Date.now(),
    });
    return;
  }

  const changes = [];

  // Detectar cambio de marcador
  if (prev.score.home !== match.score.home || prev.score.away !== match.score.away) {
    changes.push({ type: 'score', data: match.score });
    prev.score = match.score;
  }

  // Detectar cambio de estado
  if (prev.status !== match.status) {
    changes.push({ type: 'status', data: match.status });
    prev.status = match.status;
  }

  // Emitir cambios a suscriptores del partido
  for (const change of changes) {
    emitToMatch(id, change.type + '-update', change.data);
  }

  prev.lastUpdated = Date.now();
}

// ââ Suscripciones de sockets ââââââââââââââââââââââââââââââââââââââ

/**
 * Cuando un cliente se suscribe a un partido:
 * 1. Lo agrega a subscribers
 * 2. Le envÃ­a el estado actual completo
 * 3. Si no tenemos datos en vivo, los fetcha inmediatamente
 */
async function subscribeToMatch(socket, matchId, sofascoreId) {
  const id = String(matchId);

  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(socket.id);
  socket.join(`match:${id}`);

  log(`Socket ${socket.id} suscrito a partido ${id}`);

  // Guardar referencia al ID de SofaScore para enriquecer datos
  if (sofascoreId && matchStates.has(id)) {
    matchStates.get(id).sofascoreId = sofascoreId;
  }

  // Enviar estado actual si existe
  const state = matchStates.get(id);
  if (state) {
    socket.emit('match-state', state);
  }

  // Fetch enriquecido de SofaScore (alineaciones, estadÃ­sticas, H2H)
  if (sofascoreId) {
    await fetchMatchEnrichment(socket, id, sofascoreId);
  }
}

async function unsubscribeFromMatch(socket, matchId) {
  const id = String(matchId);
  if (subscribers.has(id)) {
    subscribers.get(id).delete(socket.id);
  }
  socket.leave(`match:${id}`);
}

async function fetchMatchEnrichment(socket, matchId, sofascoreId) {
  const cacheKey = `enrichment:${sofascoreId}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    socket.emit('match-enrichment', cached);
    return;
  }

  try {
    const [lineups, stats, h2h] = await Promise.allSettled([
      sofascore.getMatchLineups(sofascoreId),
      sofascore.getMatchStatistics(sofascoreId),
      sofascore.getH2H(sofascoreId),
    ]);

    const enrichment = {
      lineups: lineups.status === 'fulfilled' ? lineups.value : null,
      stats:   stats.status   === 'fulfilled' ? stats.value   : [],
      h2h:     h2h.status     === 'fulfilled' ? h2h.value     : [],
    };

    cache.set(cacheKey, enrichment, 180); // TTL 3 min
    socket.emit('match-enrichment', enrichment);

  } catch (err) {
    console.error('[poller] fetchMatchEnrichment error:', err.message);
  }
}

// ââ DetecciÃ³n de nuevas incidencias ââââââââââââââââââââââââââââââ

function detectNewIncidents(matchId, currentIncidents) {
  const state = matchStates.get(matchId);
  if (!state) return [];

  const knownIds = new Set((state.incidents || []).map(i => i.id));
  return currentIncidents.filter(i => !knownIds.has(i.id));
}

// ââ Constructor de animaciones ââââââââââââââââââââââââââââââââââââ

function buildAnimation(incident) {
  const animMap = {
    'gol':              { type: 'goal',       duration: 4000, color: '#f0c040' },
    'gol-en-contra':    { type: 'own-goal',   duration: 3000, color: '#e87040' },
    'tarjeta-amarilla': { type: 'yellow-card', duration: 2500, color: '#f5c518' },
    'tarjeta-roja':     { type: 'red-card',   duration: 2500, color: '#e84040' },
    'cambio':           { type: 'substitution', duration: 2000, color: '#3ecf8e' },
    'var':              { type: 'var',         duration: 3000, color: '#7a7f96' },
    'penal-fallado':    { type: 'missed-pen',  duration: 2500, color: '#7a7f96' },
  };

  const anim = animMap[incident.type] || { type: 'generic', duration: 1500, color: '#fff' };

  return {
    ...anim,
    incident,
    timestamp: Date.now(),
  };
}

// ââ BÃºsqueda de partidos ââââââââââââââââââââââââââââââââââââââââââ

async function searchMatches(query) {
  const cacheKey = `search:${query.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    const hasKey = apiKey && apiKey !== 'tu_clave_aqui';
    const today  = new Date().toISOString().split('T')[0];

    // Busca hoy + prÃ³ximos 7 dÃ­as en football-data si hay clave
    const nextDates = hasKey ? Array.from({length: 7}, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i + 1);
      return d.toISOString().split('T')[0];
    }) : [];

    const [sfResults, todayFD, ...nextFD] = await Promise.allSettled([
      sofascore.search(query),
      hasKey ? footballData.getTodayMatches(apiKey) : Promise.resolve([]),
      ...nextDates.map(date =>
        hasKey ? footballData.getMatchesByDate ? footballData.getMatchesByDate(apiKey, date) : Promise.resolve([]) : Promise.resolve([])
      ),
    ]);

    const q = query.toLowerCase();
    const filterFn = m => m &&
      (m.homeTeam.name.toLowerCase().includes(q) ||
       m.awayTeam.name.toLowerCase().includes(q) ||
       m.competition.toLowerCase().includes(q));

    const fdAll = [
      ...(todayFD.value || []),
      ...nextFD.flatMap(r => r.value || []),
    ].filter(filterFn);

    // Combinar: SofaScore primero (mÃ¡s datos), luego football-data
    const sfList = (sfResults.value || []).filter(Boolean);
    const combined = [...sfList, ...fdAll];

    // Separar por estado para ordenar: en vivo > terminados > prÃ³ximos
    const statusOrder = { IN_PLAY: 0, PAUSED: 0, FINISHED: 1, SCHEDULED: 2, TIMED: 2 };
    combined.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));

    // Deduplicar por nombre de equipos
    const seen = new Set();
    const results = combined.filter(m => {
      const key = `${m.homeTeam.name}|${m.awayTeam.name}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    cache.set(cacheKey, results, 60);
    return results;

  } catch (err) {
    console.error('[poller] searchMatches error:', err.message);
    return [];
  }
}

// ââ Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function emitToMatch(matchId, event, data) {
  if (io) io.to(`match:${matchId}`).emit(event, data);
}

function hasSubscribers(matchId) {
  const subs = subscribers.get(String(matchId));
  return subs && subs.size > 0;
}

function log(msg) {
  if (DEBUG) console.log(`[poller] ${msg}`);
}

function getActiveMatches() {
  return Array.from(matchStates.values()).filter(m => m.status === 'IN_PLAY');
}

module.exports = {
  init,
  stop,
  subscribeToMatch,
  unsubscribeFromMatch,
  searchMatches,
  getActiveMatches,
};
