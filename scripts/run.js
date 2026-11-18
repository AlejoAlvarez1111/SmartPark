// Ejecuta un script npm en cada componente.
//   node scripts/run.js install            -> secuencial (npm install en cada carpeta)
//   node scripts/run.js dev --parallel     -> los 5 procesos a la vez, salida con prefijo
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVICES = ['services/vehicles-service', 'services/spaces-service', 'services/reservations-service', 'services/sensors-service', 'gateway'];
const [script, flag] = process.argv.slice(2);
const parallel = flag === '--parallel';
const dirs = script === 'install' ? ['database', ...SERVICES] : SERVICES;

function run(dir) {
  const name = path.basename(dir).replace('-service', '').padEnd(12);
  const args = script === 'install' ? ['install', '--no-audit', '--no-fund'] : ['run', script, '--silent'];
  // Comando como un solo string (args son constantes): shell necesario para npm.cmd en Windows
  const child = spawn(`npm ${args.join(' ')}`, { cwd: path.join(ROOT, dir), shell: true, stdio: parallel ? 'pipe' : 'inherit' });
  if (parallel) {
    for (const stream of [child.stdout, child.stderr]) {
      let buf = '';
      stream.on('data', (chunk) => {
        const lines = (buf + chunk).split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) console.log(`[${name}] ${line}`);
      });
    }
  } else {
    console.log(`\n=== ${dir}: npm ${args.join(' ')} ===`);
  }
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

(async () => {
  const codes = parallel ? await Promise.all(dirs.map(run)) : [];
  if (!parallel) for (const dir of dirs) codes.push(await run(dir));
  process.exit(codes.some((c) => c !== 0) ? 1 : 0);
})();
