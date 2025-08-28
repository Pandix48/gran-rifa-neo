// netlify/functions/state.mjs
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL ?? process.env.NETLIFY_DATABASE_URL;

let sql = null;
try {
  if (URL) sql = neon(URL);
} catch (_) {
  sql = null;
}

// fallback en memoria si no hay DB
globalThis.__MEM__ = globalThis.__MEM__ || new Map();

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function newState(n = 20, k = 2, shape = 'star') {
  n = clamp(Math.floor(n), 1, 500);
  k = clamp(Math.floor(k), 1, 20);
  const allowed = ['star', 'circle', 'diamond'];
  if (!allowed.includes(shape)) shape = 'star';
  const base = {
    running: false,
    numCells: n,
    numShapes: k,
    shapeType: shape,
    intervalMs: 5000,
    availableNumbers: Array.from({ length: n }, (_, i) => i + 1),
    names: Array.from({ length: n }, (_, i) => `#${i + 1}`),
    filledCounts: Array.from({ length: n }, () => 0),
    prizes: [],
    winners: []
  };
  return { ...base, shape: base.shapeType }; // compat con front
}

function expose(state) {
  if (!state) return state;
  if (!state.shape) state.shape = state.shapeType || 'star';
  if (!state.shapeType) state.shapeType = state.shape;
  return state;
}

async function ensureTable() {
  if (!sql) return;
  await sql`CREATE TABLE IF NOT EXISTS states (
    room TEXT PRIMARY KEY,
    state JSONB NOT NULL
  )`;
}

async function getState(room) {
  if (!sql) return globalThis.__MEM__.get(room) || null;
  await ensureTable();
  const rows = await sql`SELECT state FROM states WHERE room = ${room}`;
  return rows.length ? rows[0].state : null;
}

async function saveState(room, state) {
  const s = expose({ ...state });
  if (!sql) { globalThis.__MEM__.set(room, s); return; }
  await ensureTable();
  await sql`INSERT INTO states (room, state) VALUES (${room}, ${s})
            ON CONFLICT (room) DO UPDATE SET state = EXCLUDED.state`;
}

export default async (request) => {
  try {
    if (request.method === 'GET') {
  const { searchParams } = new URL(request.url, "http://localhost"); 
  const room = (searchParams.get('room') || 'demo').trim();
  let state = await getState(room);

  // Auto-crea si no existe
  if (!state) {
    state = newState(20, 2, 'star');
    await saveState(room, state);
  }

  return new Response(JSON.stringify({ ok: true, state }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const room = (body.room || 'demo').trim();
      const action = body.action;
      let state = await getState(room);
      if (!state) { state = newState(); }

      switch (action) {
        case 'generate': {
          const n = body.n ?? 20;
          const k = body.k ?? 2;
          const shape = body.shape ?? 'star';
          state = newState(n, k, shape);
          state.intervalMs = Math.max(1000, parseInt(body.intervalMs || 5000));
          await saveState(room, state);
          break;
        }
        case 'reset': {
          const base = newState(state.numCells, state.numShapes, state.shapeType || state.shape || 'star');
          base.prizes = state.prizes || [];
          state = base;
          await saveState(room, state);
          break;
        }
        case 'start': {
          state.running = true;
          await saveState(room, state);
          break;
        }
        case 'stop': {
          state.running = false;
          await saveState(room, state);
          break;
        }
        case 'next': {
          if (state.availableNumbers.length > 0) {
            const idx = Math.floor(Math.random() * state.availableNumbers.length);
            const number = state.availableNumbers[idx];
            const cur = (state.filledCounts[number - 1] || 0) + 1;
            state.filledCounts[number - 1] = Math.min(cur, state.numShapes);
            if (state.filledCounts[number - 1] >= state.numShapes) {
              const name = state.names[number - 1] || `#${number}`;
              const prize = (state.prizes || [])[ (state.winners || []).length ] || 'Premio';
              state.winners = [ ...(state.winners || []), { name, prize, number } ];
              state.availableNumbers = state.availableNumbers.filter(n => n !== number);
            }
            await saveState(room, state);
          }
          break;
        }
        case 'addPrize': {
          const prize = (body.prize || '').toString();
          if (prize) state.prizes = [ ...(state.prizes || []), prize ];
          await saveState(room, state);
          break;
        }
        case 'setNames': {
          const names = Array.isArray(body.names) ? body.names.map(x => x.toString()) : [];
          for (let i = 0; i < Math.min(names.length, state.names.length); i++) {
            state.names[i] = names[i];
          }
          await saveState(room, state);
          break;
        }
        default:
          return new Response(JSON.stringify({ ok: false, error: 'Acción no soportada' }), {
            status: 400, headers: { 'content-type': 'application/json' }
          });
      }

      return new Response(JSON.stringify({ ok: true, state: expose(state) }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Método no soportado' }), {
      status: 405, headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
};
