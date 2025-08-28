// netlify/functions/state.js
import { neon } from '@neondatabase/serverless';

// Usa la URL que te inyecta Netlify (o crea DATABASE_URL alias)
const sql = neon(process.env.NETLIFY_DATABASE_URL);

async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS states (
    room TEXT PRIMARY KEY,
    state JSONB NOT NULL
  );`;
}

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

function newState(n=20,k=2,shape='star') {
  n = clamp(Math.floor(n), 1, 500);
  k = clamp(Math.floor(k), 1, 20);
  const allowed = ['star','circle','diamond'];
  if (!allowed.includes(shape)) shape='star';
  // Guardamos shapeType internamente, pero también exponemos "shape" para el front
  const base = {
    running:false,
    numCells:n,
    numShapes:k,
    shapeType: shape,           // interno
    intervalMs:5000,
    availableNumbers: Array.from({length:n}, (_,i)=>i+1),
    names: Array.from({length:n}, (_,i)=>`#${i+1}`),
    filledCounts: Array.from({length:n}, ()=>0),
    prizes: [],
    winners: []
  };
  return { ...base, shape: base.shapeType }; // compatibilidad con el front
}

function expose(state) {
  // Siempre devuelve también "shape" además de "shapeType"
  if (!state) return state;
  if (!state.shape) state.shape = state.shapeType || 'star';
  return state;
}

async function getState(room){
  await ensureTable();
  const rows = await sql`SELECT state FROM states WHERE room = ${room}`;
  if (rows.length) return expose(rows[0].state);
  return null;
}

async function saveState(room, state){
  await ensureTable();
  // Aseguramos shape/shapeType consistentes al guardar
  const s = { ...state };
  if (!s.shapeType && s.shape) s.shapeType = s.shape;
  if (!s.shape && s.shapeType) s.shape = s.shapeType;
  await sql`INSERT INTO states (room, state) VALUES (${room}, ${s}) 
            ON CONFLICT (room) DO UPDATE SET state = EXCLUDED.state;`;
}

export default async (request, context) => {
  try{
    if (request.method === 'GET') {
      const { searchParams } = new URL(request.url);
      const room = (searchParams.get('room') || 'demo').trim() || 'demo';
      const state = await getState(room);
      return new Response(JSON.stringify({ ok:true, state: expose(state) }), {
        status:200, headers: { 'content-type':'application/json' }
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const room = (body.room || 'demo').trim() || 'demo';
      const action = body.action;
      let state = await getState(room);

      switch(action){
        case 'generate': {
          const n = body.n ?? 20;
          const k = body.k ?? 2;
          const shape = body.shape ?? 'star';
          state = newState(n,k,shape);
          state.intervalMs = Math.max(1000, parseInt(body.intervalMs || 5000));
          await saveState(room, state);
          break;
        }
        case 'reset': {
          if (!state) state = newState();
          const base = newState(state.numCells, state.numShapes, state.shapeType || state.shape || 'star');
          base.prizes = state.prizes || [];
          state = base;
          await saveState(room, state);
          break;
        }
        case 'start': {
          if (!state) state = newState();
          state.running = true;
          await saveState(room, state);
          break;
        }
        case 'stop': {
          if (!state) state = newState();
          state.running = false;
          await saveState(room, state);
          break;
        }
        case 'next': {
          if (!state) state = newState();
          if (state.availableNumbers.length > 0){
            const idx = Math.floor(Math.random()*state.availableNumbers.length);
            const number = state.availableNumbers[idx];
            const cur = (state.filledCounts[number-1] || 0) + 1;
            state.filledCounts[number-1] = Math.min(cur, state.numShapes);
            if (state.filledCounts[number-1] >= state.numShapes){
              const name = state.names[number-1] || `#${number}`;
              const prize = (state.prizes||[])[(state.winners||[]).length] || 'Premio';
              state.winners = [...(state.winners||[]), { name, prize, number }];
              state.availableNumbers = state.availableNumbers.filter(n=>n!==number);
            }
            await saveState(room, state);
          }
          break;
        }
        case 'addPrize': {
          if (!state) state = newState();
          const prize = (body.prize || '').toString();
          if (prize) state.prizes = [...(state.prizes||[]), prize];
          await saveState(room, state);
          break;
        }
        case 'setNames': {
          if (!state) state = newState();
          const names = Array.isArray(body.names) ? body.names.map(x=>x.toString()) : [];
          for(let i=0; i<Math.min(names.length, state.names.length); i++){
            state.names[i] = names[i];
          }
          await saveState(room, state);
          break;
        }
        default:
          return new Response(JSON.stringify({ ok:false, error:'Acción no soportada' }), {
            status:400, headers: { 'content-type':'application/json' }
          });
      }

      return new Response(JSON.stringify({ ok:true, state: expose(state) }), {
        status:200, headers: { 'content-type':'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok:false, error:'Método no soportado' }), {
      status:405, headers: { 'content-type':'application/json' }
    });
  }catch(e){
    return new Response(JSON.stringify({ ok:false, error:String(e) }), {
      status:500, headers: { 'content-type':'application/json' }
    });
  }
}

