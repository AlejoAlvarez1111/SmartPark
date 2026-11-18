// Reglas puras de estado (sin BD), ver decisiones D3/D4 en docs/arquitectura.md

const STATUSES = ['DISPONIBLE', 'OCUPADO', 'RESERVADO', 'FUERA_DE_SERVICIO'];

// Una reserva CONFIRMADA bloquea el espacio si ya empezó o empieza dentro de la ventana de retención
function isBlocking(reservation, now, holdMs) {
  return Boolean(
    reservation &&
      reservation.startAt.getTime() <= now.getTime() + holdMs &&
      reservation.endAt.getTime() > now.getTime(),
  );
}

// Prioridad: FUERA_DE_SERVICIO > OCUPADO > RESERVADO > DISPONIBLE
function deriveStatus(operationalStatus, nextReservation, now, holdMs) {
  if (operationalStatus !== 'DISPONIBLE') return operationalStatus;
  return isBlocking(nextReservation, now, holdMs) ? 'RESERVADO' : 'DISPONIBLE';
}

function summarize(spaces) {
  const counts = () => Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byStatus = counts();
  const byType = {};
  for (const s of spaces) {
    byStatus[s.status]++;
    byType[s.spaceType] ??= { total: 0, ...counts() };
    byType[s.spaceType].total++;
    byType[s.spaceType][s.status]++;
  }
  return { total: spaces.length, byStatus, byType };
}

module.exports = { STATUSES, isBlocking, deriveStatus, summarize };
