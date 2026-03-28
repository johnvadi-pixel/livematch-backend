const express = require('express');
const { nanoid } = require('nanoid');

module.exports = function retoRoutes(supabase) {
  const router = express.Router();

  router.post('/crear', async function(req, res) {
    const { matchId, matchLabel, jugadores, nombre } = req.body;
    if (!matchId || !jugadores || jugadores.length !== 3)
      return res.status(400).json({ error: 'matchId y 3 jugadores requeridos' });
    const retoId = nanoid(6);
    const userToken = 'usr_' + nanoid(8);
    const nuevoReto = {
      id: retoId, match_id: String(matchId), match_label: matchLabel || '',
      status: 'OPEN',
      player_a: { user_token: userToken, nombre: nombre || 'Tu', jugadores: jugadores.map(String), pts: 0 },
      player_b: null, events_log: []
    };
    const { error } = await supabase.from('retos').insert(nuevoReto);
    if (error) return res.status(500).json({ error: error.message });
    const baseUrl = process.env.APP_URL || 'https://livematch-backend-production.up.railway.app';
    const link = baseUrl + '/reto/' + retoId;
    res.json({
      retoId, userToken, link,
      whatsapp: 'https://wa.me/?text=' + encodeURIComponent('Te reto en SportReto! Elige tus 3 jugadores: ' + link)
    });
  });

  router.post('/:id/aceptar', async function(req, res) {
    const { id } = req.params;
    const { jugadores, nombre } = req.body;
    if (!jugadores || jugadores.length !== 3)
      return res.status(400).json({ error: '3 jugadores requeridos' });
    const { data: reto, error: fetchErr } = await supabase.from('retos').select('*').eq('id', id).single();
    if (fetchErr || !reto) return res.status(404).json({ error: 'Reto no encontrado' });
    if (reto.status !== 'OPEN') return res.status(409).json({ error: 'Reto ya aceptado o terminado' });
    const jugadoresA = reto.player_a.jugadores || [];
    const duplicados = jugadores.filter(function(j) { return jugadoresA.includes(String(j)); });
    if (duplicados.length > 0) return res.status(400).json({ error: 'Jugadores ya elegidos por rival: ' + duplicados.join(', ') });
    const userToken = 'usr_' + nanoid(8);
    const { error: updateErr } = await supabase.from('retos').update({
      status: 'ACTIVE',
      player_b: { user_token: userToken, nombre: nombre || 'Amigo', jugadores: jugadores.map(String), pts: 0 }
    }).eq('id', id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });
    res.json({ retoId: id, userToken, status: 'ACTIVE' });
  });

  router.get('/:id/data', async function(req, res) {
    const { data: reto, error } = await supabase.from('retos').select('*').eq('id', req.params.id).single();
    if (error || !reto) return res.status(404).json({ error: 'Reto no encontrado' });
    res.json(reto);
  });

  router.get('/:id/resultado', async function(req, res) {
    const { data: reto, error } = await supabase.from('retos').select('*').eq('id', req.params.id).single();
    if (error || !reto) return res.status(404).json({ error: 'Reto no encontrado' });
    if (reto.status !== 'FINISHED') return res.json({ status: reto.status, message: 'Partido en curso' });
    const ptsA = reto.player_a && reto.player_a.pts || 0;
    const ptsB = reto.player_b && reto.player_b.pts || 0;
    res.json({
      retoId: req.params.id, matchLabel: reto.match_label, winner: reto.winner,
      diferencia: Math.abs(ptsA - ptsB), player_a: reto.player_a, player_b: reto.player_b,
      eventos_clave: (reto.events_log || []).filter(function(e) { return Math.abs(e.pts) >= 20; })
    });
  });

  return router;
};