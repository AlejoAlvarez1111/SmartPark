import { api } from '../api.js';
import { html, badge, legend, loading, errorBox, empty, fmtTime, label, STATUS } from '../ui.js';
import { lotMap, platesById } from '../lot.js';

const REFRESH_MS = 5000;

function kpis(summary) {
  const items = [['TOTAL', 'Capacidad total', summary.total], ...Object.keys(STATUS).map((s) => [s, STATUS[s].label, summary.byStatus[s]])];
  return html`<dl class="kpis">${items.map(
    ([key, text, n]) => html`<div class="kpi s-${key}"><dt>${text}</dt><dd>${n}</dd></div>`,
  )}</dl>`;
}

function recent(events) {
  if (!events.length) return empty('Aún no hay eventos. Simula una entrada desde el simulador.', html`<a class="btn" href="#simulador">Abrir simulador</a>`);
  return html`<ul class="events">${events.map(
    (e) => html`<li>
        <span><strong>${label(e.eventType)}</strong> en ${e.spaceCode ?? 'espacio desconocido'}${e.plate ? `, ${e.plate}` : ''} ${badge(e.status)}</span>
        <span class="muted small">${e.message ?? ''} (${fmtTime(e.createdAt)})</span>
      </li>`,
  )}</ul>`;
}

export async function mount(main) {
  main.innerHTML = html`<div class="page-head">
      <div><h1>Tablero</h1><p>Ocupación en tiempo casi real del parqueadero.</p></div>
      <p class="small muted" id="updated" aria-live="polite"></p>
    </div>
    <div id="body">${loading()}</div>`.s;
  const body = main.querySelector('#body');
  let plates = new Map();

  async function refresh() {
    try {
      const [data, vehicles] = await Promise.all([api('/dashboard'), api('/vehicles?limit=100').catch(() => null)]);
      if (vehicles) plates = platesById(vehicles.items);
      const warn = data.unavailable.length
        ? html`<div class="notice warn" role="alert">Sin respuesta de: ${data.unavailable.join(', ')}. Los datos de esas secciones no se muestran hasta que vuelvan.</div>`
        : '';
      body.innerHTML = html`<div class="stack">
          ${warn}
          ${data.summary ? kpis(data.summary) : ''}
          <div class="cols">
            <section class="panel" aria-labelledby="map-title">
              <div class="panel-head"><h2 id="map-title">Plano de espacios</h2>${legend()}</div>
              ${data.spaces ? lotMap(data.spaces, plates) : errorBox({ status: 503, message: 'El servicio de espacios no responde.' })}
            </section>
            <section class="panel" aria-labelledby="ev-title">
              <div class="panel-head"><h2 id="ev-title">Actividad reciente</h2><a href="#simulador" class="small">Ver todo</a></div>
              ${data.recentEvents ? recent(data.recentEvents) : errorBox({ status: 503, message: 'El servicio de sensores no responde.' })}
            </section>
          </div>
        </div>`.s;
      main.querySelector('#updated').textContent = `Actualizado a las ${fmtTime(data.generatedAt)} (se refresca cada 5 s)`;
    } catch (err) {
      body.innerHTML = errorBox(err).s;
    }
  }

  await refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  return () => clearInterval(timer);
}
