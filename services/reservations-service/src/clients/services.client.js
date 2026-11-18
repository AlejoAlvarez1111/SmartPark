// Llamadas HTTP a los servicios dueños de vehículos y espacios. Nunca se leen sus bases directamente.
const { callService, AppError, errors } = require('@smartpark/shared');

// Propaga un error de dominio del otro servicio (404, 409…) o lo trata como dependencia caída
function remoteError(serviceName, { status, body }) {
  if (body?.error && status < 500) return new AppError(status, body.error.code, body.error.message);
  return errors.unavailable(`El servicio ${serviceName} respondió con error (${status})`);
}

function createServicesClient({ vehiclesUrl, spacesUrl }) {
  return {
    // Las consultas GET se reintentan (son idempotentes)
    async getVehicle(id, requestId) {
      const r = await callService(vehiclesUrl, `/api/v1/vehicles/${id}`, { requestId, retries: 2, serviceName: 'vehicles-service' });
      if (r.status !== 200) throw remoteError('vehicles-service', r);
      return r.body.data;
    },

    async checkEligibility(spaceId, { startAt, endAt }, requestId) {
      const q = new URLSearchParams({ startAt: startAt.toISOString(), endAt: endAt.toISOString() });
      const r = await callService(spacesUrl, `/api/v1/spaces/${spaceId}/eligibility?${q}`, { requestId, retries: 2, serviceName: 'spaces-service' });
      if (r.status !== 200) throw remoteError('spaces-service', r);
      return r.body.data;
    },

    // PUT idempotente: spaces-service descarta copias más viejas o repetidas
    async pushReservation(reservationId, snapshot, requestId) {
      return callService(spacesUrl, `/api/v1/spaces/internal/reservations/${reservationId}`, {
        method: 'PUT',
        body: snapshot,
        requestId,
        serviceName: 'spaces-service',
      });
    },
  };
}

module.exports = { createServicesClient };
