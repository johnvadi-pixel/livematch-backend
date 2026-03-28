const { createClient } = require('@supabase/supabase-js');

const PUNTOS = {
  goal:40, ownGoal:-30, assist:20, penalty:15,
  penaltyMiss:-25, savedShot:15, bigChanceMissed:-8,
  yellowCard:-10, yellowRedCard:-25, redCard:-40
};

function calcularPuntos(type, extra) {
  var pts = PUNTOS[type] || 0;
  if (type === 'goal' && extra && extra.minute >= 85) pts += 30;
  return pts;
}

var supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function procesarIncidente(data) {
  if (!data || !data.matchId || !data.player || !data.player.id) return;
  var jugadorId = String(data.player.id);
  var minute = (data.time && data.time.minutes) || 0;
  var result = await supabase.from('retos').select('*')
    .eq('match_id', String(data.matchId)).eq('status', 'ACTIVE');
  var retos = result.data;
  if (!retos || !retos.length) return;
  for (var i = 0; i < retos.length; i++) {
    var reto = retos[i];
    var esA = reto.player_a && reto.player_a.jugadores && reto.player_a.jugadores.includes(jugadorId);
    var esB = reto.player_b && reto.player_b.jugadores && reto.player_b.jugadores.includes(jugadorId);
    if (!esA && !esB) continue;
    var pts = calcularPuntos(data.incidentType, { minute: minute });
    if (!pts) continue;
    var lado = esA ? 'player_a' : 'player_b';
    var oldLog = reto.events_log || [];
    var newEntry = { min: minute, jugador_id: jugadorId, nombre: (data.player.name || jugadorId), tipo: data.incidentType, pts: pts, lado: lado };
    var upd = { events_log: oldLog.concat([newEntry]) };
    upd[lado] = Object.assign({}, reto[lado], { pts: (reto[lado].pts || 0) + pts });
    if (data.incidentType === 'finalWhistle') {
      var pA = upd.player_a ? upd.player_a.pts : (reto.player_a && reto.player_a.pts || 0);
      var pB = upd.player_b ? upd.player_b.pts : (reto.player_b && reto.player_b.pts || 0);
      upd.status = 'FINISHED';
      upd.finished_at = new Date().toISOString();
      upd.winner = pA > pB ? 'a' : pB > pA ? 'b' : 'draw';
    }
    await supabase.from('retos').update(upd).eq('id', reto.id);
  }
}

module.exports = { procesarIncidente: procesarIncidente, supabase: supabase };
