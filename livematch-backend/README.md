# ⚽ LiveMatch Backend

Backend en tiempo real para el tablero de fútbol en vivo.
Combina **football-data.org** (API gratuita oficial) y **SofaScore**
(endpoints públicos) y los transmite por **WebSocket** al frontend.

---

## Estructura del proyecto

```
livematch-backend/
├── server.js                  ← Servidor principal (Express + Socket.io)
├── package.json
├── .env.example               ← Copia esto a .env y agrega tu API key
│
├── adapters/
│   ├── footballData.js        ← Adaptador football-data.org (API oficial)
│   └── sofascore.js           ← Adaptador SofaScore (sin key, scraping)
│
├── services/
│   └── matchPoller.js         ← Orquesta polling + estado + WebSocket
│
└── public/
    └── index.html             ← Frontend completo (sirve el backend mismo)
```

---

## Instalación rápida

```bash
# 1. Instalar dependencias
cd livematch-backend
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env y pon tu API key de football-data.org

# 3. Arrancar en modo desarrollo
npm run dev

# 4. Abrir en el navegador
# → http://localhost:3001
```

---

## Obtener la API key gratuita (football-data.org)

1. Ve a **https://www.football-data.org/client/register**
2. Regístrate con tu email (es gratis, sin tarjeta de crédito)
3. Recibes un email con tu API key
4. Pégala en el archivo `.env`:
   ```
   FOOTBALL_DATA_API_KEY=abc123tuclaveaqui
   ```

**Límites del plan gratuito:**
- 10 llamadas por minuto
- Acceso a: Premier League, LaLiga, Champions, Bundesliga, Serie A, Ligue 1, World Cup, Eurocopa
- Datos de: marcadores, goles, tarjetas, formaciones, tablas

---

## SofaScore (sin registro)

El adaptador de SofaScore no necesita API key. Funciona simulando
peticiones de navegador desde el servidor. Provee:

- Todos los partidos del mundo en tiempo real
- Incidencias detalladas (córners, tiros, salvadas, etc.)
- Alineaciones con posiciones reales en el campo
- Colores de uniformes de cada equipo
- Historial de enfrentamientos (H2H)
- Estadísticas del partido (posesión, tiros, pases...)

> ⚠️ Si SofaScore bloquea las peticiones, ajusta los headers en
> `adapters/sofascore.js` → constante `HEADERS`.

---

## Flujo de datos

```
football-data.org  ──┐
                     ├──► matchPoller.js ──► WebSocket ──► index.html
SofaScore          ──┘         │
                               └──► Cache (NodeCache)
```

1. El poller consulta football-data cada **30 segundos**
2. El poller consulta SofaScore cada **15 segundos**
3. Solo emite por WebSocket lo que **cambió** (marcador, nuevos eventos)
4. El frontend recibe eventos y lanza animaciones automáticamente

---

## API REST (endpoints de respaldo)

```
GET /api/health              → Estado del servidor
GET /api/matches/live        → Partidos en vivo ahora
GET /api/matches/today       → Todos los partidos de hoy
GET /api/matches/search?q=X  → Buscar por equipo/liga
GET /api/standings/PD        → Tabla LaLiga (PD, PL, CL, BL1, SA, FL1)
```

---

## WebSocket — Eventos

### El cliente envía:
| Evento | Payload | Descripción |
|--------|---------|-------------|
| `join-lobby` | — | Recibir lista de partidos en vivo |
| `search` | `{ query }` | Buscar partidos |
| `subscribe-match` | `{ matchId, sofascoreId? }` | Ver partido en vivo |
| `unsubscribe-match` | `{ matchId }` | Dejar de ver |

### El servidor emite:
| Evento | Payload | Descripción |
|--------|---------|-------------|
| `live-matches` | `Match[]` | Lista de partidos en vivo |
| `search-results` | `Match[]` | Resultados de búsqueda |
| `match-state` | `Match` | Estado completo del partido |
| `incident` | `Incident` | Nuevo evento (gol, tarjeta…) |
| `animation` | `Animation` | Qué animación disparar |
| `score-update` | `{ home, away }` | Cambio de marcador |
| `minute` | `number` | Actualización del minuto |
| `match-enrichment` | `{ lineups, stats, h2h }` | Datos detallados |

---

## Despliegue en producción

### Opción A — Railway (gratis, recomendado)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
# Configura FOOTBALL_DATA_API_KEY en las variables de entorno de Railway
```

### Opción B — Render.com (gratis)
1. Sube el código a un repo de GitHub
2. En Render: New → Web Service → conecta el repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Agrega la variable `FOOTBALL_DATA_API_KEY` en Environment

### Opción C — VPS propio (DigitalOcean, Hetzner, etc.)
```bash
# En el servidor:
git clone tu-repo
cd livematch-backend
npm install --production
# Usar PM2 para que corra siempre:
npm install -g pm2
pm2 start server.js --name livematch
pm2 save
pm2 startup
```

---

## Ajustar frecuencia de polling

En `.env`:
```
POLL_INTERVAL_MS=30000      # football-data (30s recomendado por límite de rate)
SOFASCORE_INTERVAL_MS=15000 # SofaScore (15s es seguro)
```

---

## Agregar más ligas

football-data.org usa códigos de competición. Los soportados gratis:

| Código | Liga |
|--------|------|
| `PL`   | Premier League |
| `PD`   | LaLiga |
| `CL`   | Champions League |
| `BL1`  | Bundesliga |
| `SA`   | Serie A |
| `FL1`  | Ligue 1 |
| `WC`   | World Cup |
| `EC`   | Eurocopa |
| `CLI`  | Copa Libertadores (plan de pago) |

SofaScore cubre **todas las ligas del mundo** automáticamente.
