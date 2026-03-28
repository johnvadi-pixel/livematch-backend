const { createClient } = require('@supabase/supabase-js');
const { nanoid } = require('nanoid');

const PUNTOS = {
  goal:40,ownGoal:-30,assist:20,penalty:15,
  penaltyMiss:-25,savedShot:15,bigChanceMissed:-8,
  yellowCard:-10,yellowRedCard:-25,redCard:-40
};

function calcularPuntos(type, extra) {
  let pts = PUNTOS[type] || 0;
  if (type === 'goal' && extra && extra.minute >= 85) pts += 30;
  return pts;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function procesarIncidente(data) {
  if (!data || !data.matchId || !data.player || !data.player.id) return;
  const jugadorId = String(data.player.id);
  const minute = (data.time && data.time.minutes) || 0;
  const { data: retos } = await supabase.from('retos').select('*')
    .eq('match_id', String(data.matchId)).eq('status', 'ACTIVE');
  if (!retos || !retos.length) return;
  for (const reto of retos) {
    const esA = reto.player_a && reto.player_a.jugadores && reto.player_a.jugadores.includes(jugadorId);
    const esB = reto.player_b && reto.player_b.jugadores && reto.player_b.jugadores.includes(jugadorId);
    if (!esA && !esB) continue;
    const pts = calcularPuntos(data.incidentType, { minute });
    if (!pts) continue;
    const lado = esA ? 'player_a' : 'player_b';
    const log = (reto.events_log || []).concat([{
      min: minute, jugador_id: jugadorId,
      nombre: data.player.name || jugadorId,
      tipo: data.incidentType, pts, lado
    }]);
    const upd = { events_log: log };
    upd[lado] = Object.assign({}, reto[lado], { pts: (reto[lado].pts || 0) + pts });
    if (data.incidentType === 'finalWhistle') {
      const pA = upd.player_a ? upd.player_a.pts : (reto.player_a && reto.player_a.pts || 0);
      const pB = upd.player_b ? upd.player_b.pts : (reto.player_b && reto.player_b.pts || 0);
      upd.status = 'FINISHED';
      upd.finished_at = new Date().toISOString();
      upd.winner = pA > pB ? 'a' : pB > pA ? 'b' : 'draw';
    }
    await supabase.from('retos').update(upd).eq('id', reto.id);
    // Emit update via io if available
    if (global._io) {
      const { data: updated } = await supabase.from('retos').select('*').eq('id', reto.id).single();
      if (updated) global._io.to('reto:' + reto.id).emit('reto-update', updated);
    }
  }
}

module.exports = { procesarIncidente, supabase };
