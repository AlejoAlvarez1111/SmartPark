// Logs en una línea JSON: fáciles de leer en consola y de filtrar como evidencia (§14.5)
function createLogger(service) {
  const write = (level) => (message, meta = {}) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service, message, ...meta });
    (level === 'error' ? console.error : console.log)(line);
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}

module.exports = { createLogger };
