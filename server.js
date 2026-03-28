// SportReto v2
/**
 * server.js ÃÂ¢ÃÂÃÂ Servidor principal LiveMatch
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
const retoRoutes = require('./reto-routes');
const { procesarIncidente, supabase: retoDB } = require('./reto');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Middleware ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ

app.use(cors());
app.use(function(req,res,next){res.setHeader('Content-Type','text/html; charset=utf-8');next();});
app.use(express.json());

// Sirve el frontend estÃÂÃÂ¡tico desde /public si existe
app.use(express.static(path.join(__dirname, 'public')));

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Socket.io ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ

// En producciÃÂÃÂ³n Railway asigna la URL automÃÂÃÂ¡ticamente
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
global._io = io;
app.use('/reto', retoRoutes(retoDB));
app.get('/reto/crear-ui', function(req,res){res.sendFile(path.join(__dirname,'public/reto-crear-ui.html'));
app.get('/reto/:id', function(req,res){res.sendFile(require('path').join(__dirname,'public/reto-page.html'));});});

// Inyectar io en el poller antes de inicializarlo
poller.init(io);

io.on('connection', (socket) => {
  console.log(`[socket] conectado: ${socket.id}`);

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ El cliente se une al lobby (lista de partidos en vivo) ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  socket.on('join-lobby', () => {
    socket.join('lobby');
    // Enviar lista actual de partidos activos inmediatamente
    const active = poller.getActiveMatches();
    socket.emit('live-matches', active);
  });

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ El cliente busca un partido ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  socket.on('search', async ({ query }, callback) => {
    if (!query || query.trim().length < 2) {
      return callback?.([]);
    }
    try {
      // Primero buscar en los partidos de hoy (fuente mÃÂÃÂ¡s confiable)
      const sofascore = require('./adapters/sofascore');
      const today = new Date().toISOString().split('T')[0];
      const todayMatches = await sofascore.getMatchesByDate(today);
      const q = query.trim().toLowerCase();
      const // Mapa de países (español/inglés) a nombres de selecciones y palabras clave
      const NATIONAL_MAP = {
        'argentina': ['argentina'],
        'brasil': ['brazil','brasil'], 'brazil': ['brazil','brasil'],
        'colombia': ['colombia'],
        'mexico': ['mexico','méxico'], 'méxico': ['mexico','méxico'],
        'españa': ['spain','españa'], 'spain': ['spain','españa'],
        'francia': ['france','francia'], 'france': ['france','francia'],
        'alemania': ['germany','alemania'], 'germany': ['germany','alemania'],
        'italia': ['italy','italia'], 'italy': ['italy','italia'],
        'portugal': ['portugal'],
        'inglaterra': ['england','inglaterra'], 'england': ['england','inglaterra'],
        'holanda': ['netherlands','holanda','holland'], 'netherlands': ['netherlands','holanda'],
        'belgica': ['belgium','bélgica','belgica'], 'belgium': ['belgium','bélgica'],
        'uruguay': ['uruguay'],
        'chile': ['chile'],
        'peru': ['peru','perú'], 'perú': ['peru','perú'],
        'ecuador': ['ecuador'],
        'venezuela': ['venezuela'],
        'paraguay': ['paraguay'],
        'bolivia': ['bolivia'],
        'estados unidos': ['usa','united states'], 'usa': ['usa','united states'],
        'canada': ['canada','canadá'], 'canadá': ['canada','canadá'],
        'costa rica': ['costa rica'],
        'panama': ['panama','panamá'], 'panamá': ['panama','panamá'],
        'jamaica': ['jamaica'],
        'marruecos': ['morocco','marruecos'], 'morocco': ['morocco','marruecos'],
        'senegal': ['senegal'],
        'nigeria': ['nigeria'],
        'ghana': ['ghana'],
        'camerun': ['cameroon','camerún'], 'cameroon': ['cameroon','camerún'],
        'costa de marfil': ['ivory coast','cote d'ivoire'],
        'egipto': ['egypt','egipto'], 'egypt': ['egypt','egipto'],
        'japon': ['japan','japón'], 'japan': ['japan','japón'],
        'corea': ['south korea','korea','corea'], 'korea': ['south korea','korea'],
        'australia': ['australia'],
        'iran': ['iran','irán'], 'irán': ['iran','irán'],
        'arabia saudita': ['saudi arabia'], 'saudi': ['saudi arabia'],
        'turquia': ['turkey','turquía'], 'turkey': ['turkey','turquía'],
        'croacia': ['croatia','croacia'], 'croatia': ['croatia','croacia'],
        'serbia': ['serbia'],
        'dinamarca': ['denmark','dinamarca'], 'denmark': ['denmark','dinamarca'],
        'suecia': ['sweden','suecia'], 'sweden': ['sweden','suecia'],
        'noruega': ['norway','noruega'], 'norway': ['norway','noruega'],
        'suiza': ['switzerland','suiza'], 'switzerland': ['switzerland','suiza'],
        'austria': ['austria'],
        'polonia': ['poland','polonia'], 'poland': ['poland','polonia'],
        'ucrania': ['ukraine','ucrania'], 'ukraine': ['ukraine','ucrania'],
        'rumania': ['romania','rumania'], 'romania': ['romania','rumania'],
        'hungria': ['hungary','hungría'], 'hungary': ['hungary','hungría'],
        'escocia': ['scotland','escocia'], 'scotland': ['scotland','escocia'],
        'gales': ['wales','gales'], 'wales': ['wales','gales'],
        'irlanda': ['ireland','irlanda'], 'ireland': ['ireland','irlanda'],
        'grecia': ['greece','grecia'], 'greece': ['greece','grecia'],
        'republica checa': ['czech republic','czechia'],
        'eslovakia': ['slovakia','eslovaquia'], 'slovakia': ['slovakia'],
        'albania': ['albania'], 'georgia': ['georgia'],
        'qatar': ['qatar'], 'emiratos': ['uae','emirates'],
        'china': ['china'], 'india': ['india'],
        'sudafrica': ['south africa','sudáfrica'], 'south africa': ['south africa'],
        'tunez': ['tunisia','túnez'], 'tunisia': ['tunisia'],
        'argelia': ['algeria','argelia'], 'algeria': ['algeria'],
        'cameroun': ['cameroon'], 'mali': ['mali'], 'guinea': ['guinea'],
        'selecciones': ['national','nations league','eliminatorias','world cup','copa america','euro','conmebol','concacaf','africa cup','afcon','qualifier','international'],
        'eliminatorias': ['qualifier','eliminatorias','world cup qualifier'],
        'nations league': ['nations league'],
        'copa america': ['copa america','copa américа'],
        'eurocopa': ['euro','european championship'],
        'mundial': ['world cup','fifa world cup']
      };
      // Build expanded search terms
      const searchTerms = [q];
      if (NATIONAL_MAP[q]) { searchTerms.push(...NATIONAL_MAP[q]); }
      // Also check if query matches any key and add its values
      Object.keys(NATIONAL_MAP).forEach(key => {
        if (key.includes(q) || q.includes(key)) {
          searchTerms.push(...NATIONAL_MAP[key]);
        }
      });
      const matchesSearch = (m) => {
        const home = (m.homeTeam?.name || '').toLowerCase();
        const away = (m.awayTeam?.name || '').toLowerCase();
        const comp = (m.competition || '').toLowerCase();
        const country = (m.homeTeam?.country || m.awayTeam?.country || '').toLowerCase();
        return searchTerms.some(term =>
          home.includes(term) || away.includes(term) ||
          comp.includes(term) || country.includes(term)
        );
      };
      filtered = todayMatches.filter(matchesSearch);
      if (filtered.length > 0) {
        callback?.(filtered);
        socket.emit('search-results', filtered);
        return;
      }
      // Si no hay resultados hoy, buscar en prÃÂÃÂ³ximos dÃÂÃÂ­as
      const results = await poller.searchMatches(query.trim());
      callback?.(results);
      socket.emit('search-results', results);
    } catch (err) {
      console.error('[socket] search error:', err.message);
      callback?.([]);
    }
  });

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ El cliente se suscribe a un partido especÃÂÃÂ­fico ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  // matchId: ID de football-data (o cualquier fuente)
  // sofascoreId: ID en SofaScore para datos enriquecidos (opcional)
  socket.on('subscribe-match', async ({ matchId, sofascoreId }) => {
    if (!matchId) return;
    await poller.subscribeToMatch(socket, matchId, sofascoreId);

    // Si el partido ya terminÃÂÃÂ³, enviar resumen post-partido
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

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ El cliente cancela suscripciÃÂÃÂ³n ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  socket.on('unsubscribe-match', async ({ matchId }) => {
    if (!matchId) return;
    await poller.unsubscribeFromMatch(socket, matchId);
  });

  // ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ DesconexiÃÂÃÂ³n ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
  socket.on('disconnect', (reason) => {
    console.log(`[socket] desconectado: ${socket.id} ÃÂ¢ÃÂÃÂ ${reason}`);
  });
});

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ REST API (endpoints de respaldo sin WebSocket) ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ

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
    return res.status(400).json({ ok: false, error: 'ParÃÂÃÂ¡metro q requerido (mÃÂÃÂ­n 2 chars)' });
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
 * Todos los partidos de hoy (en curso, terminados, prÃÂÃÂ³ximos)
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ Arranque ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ

server.listen(PORT, () => {
  console.log('');
  console.log('  ÃÂ¢ÃÂÃÂ½  LiveMatch Backend corriendo');
  console.log(`  ÃÂ¢ÃÂÃÂ  http://localhost:${PORT}`);
  console.log(`  ÃÂ¢ÃÂÃÂ  WebSocket en ws://localhost:${PORT}`);
  console.log('');

  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key || key === 'tu_clave_aqui') {
    console.warn('  ÃÂ¢ÃÂÃÂ   FOOTBALL_DATA_API_KEY no configurada');
    console.warn('     RegÃÂÃÂ­strate gratis en https://www.football-data.org/client/register');
    console.warn('     Edita el archivo .env con tu clave');
    console.warn('');
  } else {
    console.log('  ÃÂ¢ÃÂÃÂ  football-data.org configurado');
  }
  console.log('  ÃÂ¢ÃÂÃÂ  SofaScore activo (sin clave requerida)');
  console.log('');
});

// Manejo graceful de cierre
process.on('SIGTERM', () => {
  poller.stop();
  server.close(() => process.exit(0));
});
