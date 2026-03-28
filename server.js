/**
 * server.js — Servidor principal LiveMatch
 *
 * Arranca Express (API REST) + Socket.io (tiempo real)
 * y conecta el MatchPoller que orquesta football-data + SofaScore.
 *
 * Uso:
 *   cp .env.example .env
 *   # edita .env con tu API key de football-data.org
 *   npm install
 *   npm run dev
 */

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const poller     = require('./services/matchPoller');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Sirve el frontend estático desde /public si existe
app.use(express.static(path.join(__dirname, 'public')));

// ── Socket.io ─────────────────────────────────────────────────────

// En producción Railway asigna la URL automáticamente
// ALLOWED_ORIGIN puede ser '*' o tu dominio exacto: 'https://miapp.up.railway.app'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  // Transports: Railway soporta WebSocket nativo
  transports: ['websocket', 'polling'],
});

// Inyectar io en el poller antes de inicializarlo
poller.init(io);

io.on('connection', (socket) => {
  console.log(`[socket] conectado: ${socket.id}`);

  // ── El cliente se une al lobby (lista de partidos en vivo) ──
  socket.on('join-lobby', () => {
    socket.join('lobby');
    // Enviar lista actual de partidos activos inmediatamente
    const active = poller.getActiveMatches();
    socket.emit('live-matches', active);
  });

  // ── El cliente busca un partido ──
  socket.on('search', async ({ query }, callback) => {
    if (!query || query.trim().length < 2) {
      return callback?.([]);
    }
    try {
      // Primero buscar en los partidos de hoy (fuente más confiable)
      const sofascore = require('./adapters/sofascore');
      const today = new Date().toISOString().split('T')[0];
      const todayMatches = await sofascore.getMatchesByDate(today);
      const q = query.trim().toLowerCase();
      const filtered = todayMatches.filter(m =>
        (m.homeTeam?.name || '').toLowerCase().includes(q) ||
        (m.awayTeam?.name || '').toLowerCase().includes(q) ||
        (m.competition || '').toLowerCase().includes(q)
      );
      if (filtered.length > 0) {
        callback?.(filtered);
        socket.emit('search-results', filtered);
        return;
      }
      // Si no hay resultados hoy, buscar en próximos días
      const results = await poller.searchMatches(query.trim());
      callback?.(results);
      socket.emit('search-results', results);
    } catch (err) {
      console.error('[socket] search error:', err.message);
      callback?.([]);
    }
  });

  // ── El cliente se suscribe a un partido específico ──
  // matchId: ID de football-data (o cualquier fuente)
  // sofascoreId: ID en SofaScore para datos enriquecidos (opcional)
  socket.on('subscribe-match', async ({ matchId, sofascoreId }) => {
    if (!matchId) return;
    await poller.subscribeToMatch(socket, matchId, sofascoreId);

    // Si el partido ya terminó, enviar resumen post-partido
    const sfId = sofascoreId || matchId;
    try {
      const sofascore = require('./adapters/sofascore');
      const today = await sofascore.getMatchesByDate(new Date().toISOString().split('T')[0]);
      const match = today.find(m => String(m.id) === String(sfId) || String(m.id) === String(matchId));
      if (match && match.status === 'FINISHED') {
        const [bestPlayers, events] = await Promise.allSettled([
          sofascore.getBestPlayers(sfId),
          sofascore.getMatchEvents(sfId),
        ]);
        socket.emit('match-summary', {
          bestPlayers: bestPlayers.value || { home: [], away: [], playerOfMatch: null },
          events: events.value || [],
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          score: match.score,
          competition: match.competition,
          competitionId: match.competitionId,
        });
      }
    } catch(e) {
      console.error('[subscribe-match] post-match summary error:', e.message);
    }
  });

  // ── El cliente cancela suscripción ──
  socket.on('unsubscribe-match', async ({ matchId }) => {
    if (!matchId) return;
    await poller.unsubscribeFromMatch(socket, matchId);
  });

  // ── Desconexión ──
  socket.on('disconnect', (reason) => {
    console.log(`[socket] desconectado: ${socket.id} — ${reason}`);
  });
});

// ── REST API (endpoints de respaldo sin WebSocket) ─────────────────

/**
 * GET /api/matches/live
 * Lista de todos los partidos en vivo ahora mismo
 */
app.get('/api/matches/live', async (req, res) => {
  try {
    const matches = poller.getActiveMatches();
    res.json({ ok: true, count: matches.length, matches });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/matches/search?q=real+madrid
 * Busca partidos por nombre de equipo o liga
 */
app.get('/api/matches/search', async (req, res) => {
  const q = req.query.q;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ ok: false, error: 'Parámetro q requerido (mín 2 chars)' });
  }
  try {
    const results = await poller.searchMatches(q.trim());
    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/matches/today
 * Todos los partidos de hoy (en curso, terminados, próximos)
 */
app.get('/api/matches/today', async (req, res) => {
  const footballData = require('./adapters/footballData');
  const sofascore    = require('./adapters/sofascore');
  const today = new Date().toISOString().split('T')[0];

  try {
    const [fdMatches, sfMatches] = await Promise.allSettled([
      process.env.FOOTBALL_DATA_API_KEY !== 'tu_clave_aqui'
        ? footballData.getTodayMatches(process.env.FOOTBALL_DATA_API_KEY)
        : Promise.resolve([]),
      sofascore.getMatchesByDate(today),
    ]);

    const matches = [
      ...(fdMatches.value || []),
      ...(sfMatches.value || []),
    ];

    res.json({ ok: true, count: matches.length, matches });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/standings/:competition
 * Tabla de posiciones (ej: /api/standings/PD para LaLiga)
 */
app.get('/api/standings/:competition', async (req, res) => {
  const footballData = require('./adapters/footballData');
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey || apiKey === 'tu_clave_aqui') {
    return res.status(503).json({ ok: false, error: 'FOOTBALL_DATA_API_KEY no configurada' });
  }

  try {
    const standings = await footballData.getStandings(apiKey, req.params.competition.toUpperCase());
    res.json({ ok: true, competition: req.params.competition, standings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/health
 * Verifica que el servidor funcione
 */
/**
 * GET /api/match/:id/summary
 * Resumen post-partido: mejores jugadores + eventos
 */
app.get('/api/match/:id/summary', async (req, res) => {
  const sofascore = require('./adapters/sofascore');
  const matchId = req.params.id;
  try {
    const [bestPlayers, events] = await Promise.allSettled([
      sofascore.getBestPlayers(matchId),
      sofascore.getMatchEvents(matchId),
    ]);
    res.json({
      ok: true,
      bestPlayers: bestPlayers.value || { home: [], away: [], playerOfMatch: null },
      events: events.value || [],
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/standings/:tournamentId/:seasonId
 * Tabla de posiciones de un torneo
 */
app.get('/api/standings/:tournamentId/:seasonId', async (req, res) => {
  const sofascore = require('./adapters/sofascore');
  const { tournamentId, seasonId } = req.params;
  try {
    // Si seasonId es 'current', obtener la temporada actual del torneo
    let resolvedSeasonId = seasonId;
    if (seasonId === 'current') {
      const axios = require('axios');
      try {
        const r = await axios.get(`https://api.sofascore.com/api/v1/unique-tournament/${tournamentId}/seasons`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.sofascore.com/',
            'Origin': 'https://www.sofascore.com',
          }
        });
        resolvedSeasonId = r.data.seasons?.[0]?.id || seasonId;
      } catch(e) { /* use seasonId as-is */ }
    }
    const rows = await sofascore.getStandings(tournamentId, resolvedSeasonId);
    res.json({ ok: true, standings: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    activeMatches: poller.getActiveMatches().length,
    timestamp: new Date().toISOString(),
  });
});

// ── Arranque ──────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('');
  console.log('  ⚽  LiveMatch Backend corriendo');
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ➜  WebSocket en ws://localhost:${PORT}`);
  console.log('');

  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key || key === 'tu_clave_aqui') {
    console.warn('  ⚠  FOOTBALL_DATA_API_KEY no configurada');
    console.warn('     Regístrate gratis en https://www.football-data.org/client/register');
    console.warn('     Edita el archivo .env con tu clave');
    console.warn('');
  } else {
    console.log('  ✓  football-data.org configurado');
  }
  console.log('  ✓  SofaScore activo (sin clave requerida)');
  console.log('');
});

// Manejo graceful de cierre
process.on('SIGTERM', () => {
  poller.stop();
  server.close(() => process.exit(0));
});
