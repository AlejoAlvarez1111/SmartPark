import { api } from '../api.js';
import { html, badge, loading, errorBox, fmtTime } from '../ui.js';

const DESCRIPTIONS = {
  vehicles: 'Registro de vehículos',
  spaces: 'Espacios, ocupación y disponibilidad',
  reservations: 'Reservas',
  sensors: 'Sensores simulados e historial de eventos',
};

export async function mount(main) {
  main.innerHTML = html`<div class="page-head">
      <div><h1>Estado del sistema</h1><p>Disponibilidad del gateway y de cada servicio.</p></div>
      <button class="btn" id="check">Comprobar ahora</button>
    </div>
    <section class="panel" id="body">${loading('Consultando servicios…')}</section>`.s;
  const body = main.querySelector('#body');

  async function refresh() {
    try {
      const h = await api('/health');
      body.innerHTML = html`<div class="panel-head">
          <h2>Gateway ${badge('UP')}</h2>
          <span class="small muted">Última comprobación a las ${fmtTime(h.timestamp)} (se repite cada 10 s)</span>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th scope="col">Servicio</th><th scope="col">Función</th><th scope="col">Estado</th><th scope="col">Base de datos</th><th scope="col">Versión</th></tr></thead>
          <tbody>${Object.entries(h.services).map(
            ([key, s]) => html`<tr>
                <td class="code">${s.service}</td><td>${DESCRIPTIONS[key] ?? ''}</td><td>${badge(s.status)}</td>
                <td>${s.database === 'UP' ? badge('UP') : s.database === 'DOWN' ? badge('DOWN') : html`<span class="muted">Desconocido</span>`}</td>
                <td>${s.version ?? '—'}</td>
              </tr>`,
          )}</tbody>
        </table></div>
        ${h.status !== 'UP' ? html`<p class="notice warn" style="margin-top:14px">Hay servicios sin respuesta. Las secciones que dependen de ellos mostrarán un error controlado hasta que vuelvan.</p>` : ''}`.s;
    } catch (err) {
      body.innerHTML = errorBox(err).s;
    }
  }

  main.querySelector('#check').addEventListener('click', refresh);
  await refresh();
  const timer = setInterval(refresh, 10_000);
  return () => clearInterval(timer);
}
