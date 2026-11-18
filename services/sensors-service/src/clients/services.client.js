// Llamadas HTTP a vehículos, espacios y reservas. Devuelven { status, body } sin interpretar:
// el servicio de eventos decide si la respuesta es un rechazo (4xx) o un fallo de dependencia (5xx / sin respuesta).
// Todas se pueden reintentar: GET, y POST idempotentes por eventId o por estado destino.
const { callService } = require('@smartpark/shared');

function createServicesClient({ vehiclesUrl, spacesUrl, reservationsUrl }) {
  const opts = (serviceName, requestId, extra = {}) => ({ serviceName, requestId, retries: 2, ...extra });
  return {
    getVehicle: (id, requestId) => callService(vehiclesUrl, `/api/v1/vehicles/${id}`, opts('vehicles-service', requestId)),
    getSpace: (id, requestId) => callService(spacesUrl, `/api/v1/spaces/${id}`, opts('spaces-service', requestId)),
    occupy: (spaceId, body, requestId) =>
      callService(spacesUrl, `/api/v1/spaces/${spaceId}/occupy`, opts('spaces-service', requestId, { method: 'POST', body })),
    release: (spaceId, body, requestId) =>
      callService(spacesUrl, `/api/v1/spaces/${spaceId}/release`, opts('spaces-service', requestId, { method: 'POST', body })),
    startReservation: (id, requestId) =>
      callService(reservationsUrl, `/api/v1/reservations/internal/${id}/start`, opts('reservations-service', requestId, { method: 'POST' })),
    completeReservation: (id, requestId) =>
      callService(reservationsUrl, `/api/v1/reservations/${id}/complete`, opts('reservations-service', requestId, { method: 'POST' })),
  };
}

module.exports = { createServicesClient };
