const { createClient } = require('@supabase/supabase-js');
const { nanoid } = require('nanoid');
const PUNTOS = { goal:40,ownGoal:-30,assist:20,penalty:15,penaltyMiss:-25,savedShot:15,bigChanceMissed:-8,yellowCard:-10,yellowRedCard:-25,redCard:-40 };
function calcularPuntos(type,extra){let pts=PUNTOS[type]||0;if(type==='goal'&&extra&&extra.minute>=85)pts+=30;return pts;}
module.exports=function initReto(io){
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_KEY);
  async function emitRetoUpdate(id){const{data:r}=await supabase.from('retos').select('*').eq('id',id).single();if(r)io.to('reto:'+id).emit('reto-update',r);}
  async function procesarIncidente(data){
    if(!data||!data.matchId||!data.player||!data.player.id)return;
    const jid=String(data.player.id),min=(data.time&&data.time.minutes)||0;
    const{data:retos}=await supabase.from('retos').select('*').eq('match_id',String(data.matchId)).eq('status','ACTIVE');
    if(!retos||!retos.length)return;
    for(const reto of retos){
      const esA=reto.player_a&&reto.player_a.jugadores&&reto.player_a.jugadores.includes(jid);
      const esB=reto.player_b&&reto.player_b.jugadores&&reto.player_b.jugadores.includes(jid);
      if(!esA&&!esB)continue;
      const pts=calcularPuntos(data.incidentType,{minute:min});
      if(!pts)continue;
      const lado=esA?'player_a':'player_b';
      const log=(reto.events_log||[]).concat([{min:min,jugador_id:jid,nombre:data.player.name||jid,tipo:data.incidentType,pts:pts,lado:lado}]);
      const upd={events_log:log};
      upd[lado]=Object.assign({},reto[lado],{pts:(reto[lado].pts||0)+pts});
      if(data.incidentType==='finalWhistle'){
        const pA=upd.player_a?upd.player_a.pts:(reto.player_a&&reto.player_a.pts||0);
        const pB=upd.player_b?upd.player_b.pts:(reto.player_b&&reto.player_b.pts||0);
        upd.status='FINISHED';upd.finished_at=new Date().toISOString();
        upd.winner=pA>pB?'a':pB>pA?'b':'draw';
      }
      await supabase.from('retos').update(upd).eq('id',reto.id);
      await emitRetoUpdate(reto.id);
    }
  }
  io.on('connection',function(socket){
    socket.on('join-reto',function(id){socket.join('reto:'+id);});
    socket.on('leave-reto',function(id){socket.leave('reto:'+id);});
  });
  return{procesarIncidente,supabase};
};