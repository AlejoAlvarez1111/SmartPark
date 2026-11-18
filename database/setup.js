// Crea las 4 bases y el usuario de aplicación, aplica migraciones y luego seeds.
// Es idempotente (IF NOT EXISTS / INSERT IGNORE): se puede ejecutar varias veces.
// El prefijo del archivo SQL (001_vehicles.sql -> vehicles) indica la base donde se aplica.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const env = process.env;
const DATABASES = {
  vehicles: env.VEHICLES_DB || 'smartpark_vehicles',
  spaces: env.SPACES_DB || 'smartpark_spaces',
  reservations: env.RESERVATIONS_DB || 'smartpark_reservations',
  sensors: env.SENSORS_DB || 'smartpark_sensors',
};

async function connectWithRetry(attempts = 15) {
  for (let i = 1; ; i++) {
    try {
      return await mysql.createConnection({
        host: env.DB_HOST || 'localhost',
        port: Number(env.DB_PORT) || 3306,
        user: env.DB_ROOT_USER || 'root',
        password: env.DB_ROOT_PASSWORD,
        multipleStatements: true,
        timezone: 'Z',
      });
    } catch (err) {
      // Solo se reintenta si MySQL aún arranca; credenciales malas no se arreglan reintentando
      if (i >= attempts || err.code === 'ER_ACCESS_DENIED_ERROR') throw err;
      console.log(`MySQL aún no responde (${err.code || err.message}); reintento ${i}/${attempts}...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function applyDir(conn, dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const key = file.replace(/^\d+_/, '').replace(/\.sql$/, '');
    const db = DATABASES[key];
    if (!db) throw new Error(`No sé a qué base pertenece ${file} (prefijos válidos: ${Object.keys(DATABASES).join(', ')})`);
    await conn.query(`USE ??`, [db]);
    await conn.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log(`  ✔ ${path.basename(dir)}/${file} -> ${db}`);
  }
}

async function main() {
  const conn = await connectWithRetry();
  try {
    await conn.query("SET time_zone = '+00:00'");
    const user = env.DB_USER || 'smartpark_user';
    await conn.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [user, env.DB_PASSWORD]);
    await conn.query(`ALTER USER ?@'%' IDENTIFIED BY ?`, [user, env.DB_PASSWORD]);
    for (const db of Object.values(DATABASES)) {
      await conn.query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [db]);
      // shortcut: un solo usuario con acceso a las 4 bases; para aislar de verdad, un usuario por servicio
      await conn.query(`GRANT ALL PRIVILEGES ON ??.* TO ?@'%'`, [db, user]);
    }
    console.log('Bases y usuario listos. Migraciones:');
    await applyDir(conn, path.join(__dirname, 'migrations'));
    if (!process.argv.includes('--no-seed')) {
      console.log('Seeds:');
      await applyDir(conn, path.join(__dirname, 'seeds'));
    }
    console.log('Base de datos lista.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Error preparando la base de datos:', err.message);
  if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('Revisa DB_ROOT_USER y DB_ROOT_PASSWORD en .env (deben ser las credenciales de administrador de tu MySQL).');
  }
  process.exit(1);
});
