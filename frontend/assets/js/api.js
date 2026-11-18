// Cliente del gateway. El frontend solo habla con /api/v1 (mismo origen).

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Devuelve la respuesta completa { success, data, message } o lanza ApiError
export async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api/v1' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No hay conexión con el gateway. Comprueba que el sistema esté en ejecución.');
  }
  const json = await res.json().catch(() => null);
  if (!json) throw new ApiError(res.status, 'INVALID_RESPONSE', `El servidor respondió sin datos válidos (HTTP ${res.status}).`);
  if (!json.success) throw new ApiError(res.status, json.error.code, json.error.message, json.error.details);
  return json;
}

export const api = async (path, options) => (await request(path, options)).data;

// Construye ?a=1&b=2 omitiendo vacíos
export const query = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return q.toString() ? `?${q}` : '';
};
