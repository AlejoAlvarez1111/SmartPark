// Reglas puras de reservas (sin BD)

// Intervalos semiabiertos [start, end): 14:00-16:00 y 16:00-18:00 no se solapan
const overlaps = (a, b) => a.startAt < b.endAt && b.startAt < a.endAt;

// Transiciones permitidas por acción. EXPIRADA no se automatiza en el prototipo (ver docs/arquitectura.md).
const TRANSITIONS = {
  cancel: { from: ['CONFIRMADA'], to: 'CANCELADA' },
  start: { from: ['CONFIRMADA'], to: 'EN_CURSO' },
  complete: { from: ['CONFIRMADA', 'EN_CURSO'], to: 'COMPLETADA' },
};

// 'apply' | 'noop' (ya está en el estado destino: repetir la acción es idempotente) | 'invalid'
function transitionResult(action, currentStatus) {
  const t = TRANSITIONS[action];
  if (currentStatus === t.to) return 'noop';
  return t.from.includes(currentStatus) ? 'apply' : 'invalid';
}

const startsTooEarly = (startAt, now, toleranceMinutes) => startAt.getTime() < now.getTime() - toleranceMinutes * 60_000;

module.exports = { overlaps, TRANSITIONS, transitionResult, startsTooEarly };
