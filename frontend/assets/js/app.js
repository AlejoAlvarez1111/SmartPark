// Enrutador por hash y estado de conexión global
import { api } from './api.js';
import * as dashboard from './views/dashboard.js';
import * as spaces from './views/spaces.js';
import * as vehicles from './views/vehicles.js';
import * as reservations from './views/reservations.js';
import * as simulator from './views/simulator.js';
import * as system from './views/system.js';

const ROUTES = {
  dashboard: [dashboard, 'Tablero'],
  espacios: [spaces, 'Espacios'],
  vehiculos: [vehicles, 'Vehículos'],
  reservas: [reservations, 'Reservas'],
  simulador: [simulator, 'Simulador'],
  sistema: [system, 'Estado del sistema'],
};

const main = document.getElementById('main');
let cleanup = null;

async function navigate() {
  const route = location.hash.slice(1).split('?')[0] || 'dashboard';
  const [view, title] = ROUTES[route] ?? ROUTES.dashboard;
  cleanup?.();
  cleanup = null;
  document.title = `${title} · SmartPark`;
  document.querySelectorAll('[data-route]').forEach((a) => a.removeAttribute('aria-current'));
  document.querySelector(`[data-route="${ROUTES[route] ? route : 'dashboard'}"]`)?.setAttribute('aria-current', 'page');
  main.innerHTML = '';
  cleanup = (await view.mount(main)) ?? null;
}

// Indicador de conexión: consulta /health del gateway cada 10 s
async function checkConnection() {
  const el = document.getElementById('connection');
  const text = el.querySelector('.connection-text');
  try {
    const { services } = await api('/health');
    const list = Object.values(services);
    const up = list.filter((s) => s.status === 'UP').length;
    el.dataset.state = up === list.length ? 'ok' : 'degraded';
    text.textContent = up === list.length ? 'Todos los servicios activos' : `${up} de ${list.length} servicios activos`;
  } catch {
    el.dataset.state = 'down';
    text.textContent = 'Sin conexión con el gateway';
  }
}

window.addEventListener('hashchange', navigate);
navigate();
checkConnection();
setInterval(checkConnection, 10_000);
