/**
 * Pool MySQL de un servicio. Recibe el módulo mysql2/promise del servicio para que
 * shared no tenga dependencias propias. Todas las fechas viajan en UTC.
 */
function createDb(mysql, database, env = process.env) {
  const pool = mysql.createPool({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database,
    connectionLimit: 10,
    connectTimeout: 2000,
    timezone: 'Z',
  });
  // Sesión en UTC para que CURRENT_TIMESTAMP y las fechas guardadas sean UTC (§5.1)
  pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

  const ping = async () => {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  };

  // Ejecuta fn(conn) dentro de una transacción; hace rollback si fn lanza
  const transaction = async (fn) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  };

  return { pool, ping, transaction };
}

module.exports = { createDb };
