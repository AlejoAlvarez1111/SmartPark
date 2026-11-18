const { AppError } = require('./errors');

const DEFAULT_TIMEOUT_MS = Number(process.env.SERVICE_TIMEOUT_MS) || 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Llamada HTTP/JSON a otro servicio con timeout y reintentos limitados.
 * Solo reintenta fallos de red/timeout (el servicio no respondió); una respuesta HTTP,
 * aunque sea 4xx/5xx, se devuelve tal cual para que el llamador decida.
 * Si el servicio no responde tras los reintentos lanza 503 DEPENDENCY_UNAVAILABLE.
 */
async function callService(baseUrl, path, { method = 'GET', body, requestId, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, serviceName = baseUrl } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (requestId) headers['x-request-id'] = requestId;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // respuesta no JSON: se trata como fallo del servicio remoto
      }
      return { status: res.status, body: json };
    } catch (err) {
      if (attempt >= retries) {
        throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', `El servicio ${serviceName} no está disponible`, {
          cause: err.name === 'TimeoutError' ? 'timeout' : 'connection',
        });
      }
      await sleep(200 * 2 ** attempt);
    }
  }
}

module.exports = { callService };
