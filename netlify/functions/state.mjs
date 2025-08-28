// netlify/functions/state.mjs
// Función mínima en memoria (sin DB) + acciones nuevas: setPrizes y removePrize

const ROOMS = globalThis.__ROOMS__ || new Map();
globalThis.__ROOMS__ = ROOMS;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function newState(n = 20, k = 2, shape = 'star') {
  n = clamp(Math.floor(n), 1, 500);
  k = clamp(Math.floor(k), 1, 20);
  const allowed = ['star', 'circle', 'diamond'];
  if (!allowed.includes(shape)) shape = 'star';

  const s = {
    running: false,
    numCells: n,
    numShapes: k,
    shapeType: shape,
    shape, // compat
    intervalMs: 5000,
    availableNumbers: Array.from({ length: n }, (_, i) => i + 1),
    names: Array.from({ length: n }, (_, i) => `#${i + 1}`),
    filledCounts: Array.from({ length: n }, () => 0),
    prizes: [],
    winners: []
  };
  return s;
}

function get(room) { return ROOMS.get(room) || null; }
function set(room, state) { ROOMS.set(room, state); }

export default async (request) => {
  try {
    if (request.method === 'GET') {
  const { searchParams } = new URL(request.url, 'http://localhost');
  const room = (searchParams.get('room') || 'demo').trim() || 'demo';

  const state = get(room) || null; // ✅ si no hay, devuelve null
  return new Response(JSON.stringify({ ok: true, state }), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
}

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const room = (body.room || 'demo').trim() || 'demo';
      const action = body.action;
      let state = get(room) || newState();

      switch (action) {
        case 'generate': {
          const n = body.n ?? 20;
          const k = body.k ?? 2;
          const shape = body.shape ?? 'star';
          state = newState(n, k, shape);
          state.intervalMs = Math.max(1000, parseInt(body.intervalMs || 5000, 10));
          set(room, state);
          break;
        }
        case 'reset': {
          const base = newState(state.numCells, state.numShapes, state.shapeType || state.shape || 'star');
          base.prizes = state.prizes || [];
          set(room, base);
          state = base;
          break;
        }
        case 'start': {
          state.running = true;
          set(room, state);
          break;
        }
        case 'stop': {
          state.running = false;
          set(room, state);
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
            set(room, state);
          }
          break;
        }
        case 'addPrize': {
          const prize = (body.prize || '').toString().trim();
          if (prize) state.prizes = [ ...(state.prizes || []), prize ];
          set(room, state);
          break;
        }
        case 'setPrizes': {
          const prizes = Array.isArray(body.prizes) ? body.prizes.map(x => x.toString()) : [];
          state.prizes = prizes;
          set(room, state);
          break;
        }
        case 'removePrize': {
          const index = Number(body.index);
          if (Number.isInteger(index) && index >= 0 && index < (state.prizes || []).length) {
            state.prizes.splice(index, 1);
            set(room, state);
          }
          break;
        }
        case 'setNames': {
          const names = Array.isArray(body.names) ? body.names.map(x => x.toString()) : [];
          for (let i = 0; i < Math.min(names.length, state.names.length); i++) {
            state.names[i] = names[i];
          }
          set(room, state);
          break;
        }
        default:
          return new Response(JSON.stringify({ ok: false, error: 'Acción no soportada' }), {
            status: 400, headers: { 'content-type': 'application/json' }
          });
      }

      return new Response(JSON.stringify({ ok: true, state }), {
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
