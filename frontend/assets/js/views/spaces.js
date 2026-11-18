import { api, query } from '../api.js';
import { html, badge, legend, loading, errorBox, empty, label, fmtDate, toast, confirmDialog, formDialog, field, STATUS, count } from '../ui.js';
import { lotMap, platesById } from '../lot.js';

const TYPES = [['ESTANDAR', 'Estándar'], ['ACCESIBLE', 'Accesible'], ['MOTO', 'Moto']];

function spaceForm(space = {}) {
  return [
    field({ name: 'code', label: 'Código', value: space.code ?? '', required: true, hint: 'Por ejemplo A-11. Debe ser único.', attrs: 'maxlength="10" autocomplete="off"' }),
    field({ name: 'zone', label: 'Zona', value: space.zone ?? '', required: true, attrs: 'maxlength="20" autocomplete="off"' }),
    field({ name: 'spaceType', label: 'Tipo', value: space.spaceType ?? 'ESTANDAR', options: TYPES, required: true, full: true }),
  ];
}

export async function mount(main) {
  const state = { status: '', type: '', zone: '', view: 'table' };
  main.innerHTML = html`<div class="page-head">
      <div><h1>Espacios</h1><p>Inventario y estado operativo de cada espacio.</p></div>
      <button class="btn btn-primary" id="new">Crear espacio</button>
    </div>
    <section class="panel stack">
      <form class="filters" id="filters" aria-label="Filtrar espacios">
        <div class="field"><label for="fs">Estado</label><select id="fs" name="status"><option value="">Todos</option>${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}</select></div>
        <div class="field"><label for="ft">Tipo</label><select id="ft" name="type"><option value="">Todos</option>${TYPES.map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
        <div class="field"><label for="fz">Zona</label><input id="fz" name="zone" maxlength="20" placeholder="Todas"></div>
        <div class="segmented" role="group" aria-label="Vista">
          <button type="button" data-view="table" aria-pressed="true">Tabla</button>
          <button type="button" data-view="grid" aria-pressed="false">Plano</button>
        </div>
      </form>
      <div id="list">${loading()}</div>
    </section>`.s;
  const list = main.querySelector('#list');

  async function refresh() {
    try {
      const [spaces, vehicles] = await Promise.all([
        api('/spaces' + query({ status: state.status, type: state.type, zone: state.zone })),
        api('/vehicles?limit=100').catch(() => null),
      ]);
      const plates = platesById(vehicles?.items);
      if (!spaces.length) {
        list.innerHTML = empty('Ningún espacio coincide con los filtros.').s;
        return;
      }
      list.innerHTML = (state.view === 'grid' ? html`${legend()}<div style="margin-top:12px">${lotMap(spaces, plates)}</div>` : table(spaces, plates)).s;
    } catch (err) {
      list.innerHTML = errorBox(err).s;
    }
  }

  function table(spaces, plates) {
    return html`<div class="table-wrap"><table>
        <caption>${count(spaces.length, 'espacio', 'espacios')}</caption>
        <thead><tr><th scope="col">Código</th><th scope="col">Zona</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Detalle</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${spaces.map((s) => {
          const off = s.status === 'FUERA_DE_SERVICIO';
          // Solo un espacio libre y sin reservas puede ponerse fuera de servicio (RF-05)
          const canDisable = s.status === 'DISPONIBLE' && !s.nextReservation;
          const detail = s.occupancy
            ? `${plates.get(s.occupancy.vehicleId) ?? 'Vehículo'} desde ${fmtDate(s.occupancy.entryAt)}`
            : s.nextReservation
              ? `Reserva de ${plates.get(s.nextReservation.vehicleId) ?? 'un vehículo'} el ${fmtDate(s.nextReservation.startAt)}`
              : '';
          return html`<tr>
              <td class="code">${s.code}</td><td>${s.zone}</td><td>${label(s.spaceType)}</td><td>${badge(s.status)}</td>
              <td class="small">${detail || html`<span class="muted">—</span>`}</td>
              <td class="actions">
                <button class="btn btn-small" data-edit="${s.id}">Editar</button>
                ${off
                  ? html`<button class="btn btn-small" data-enable="${s.id}" data-code="${s.code}">Habilitar</button>`
                  : html`<button class="btn btn-small btn-danger" data-disable="${s.id}" data-code="${s.code}" ${canDisable ? '' : html`disabled title="Solo un espacio disponible y sin reservas puede ponerse fuera de servicio"`}>Poner fuera de servicio</button>`}
              </td>
            </tr>`;
        })}</tbody>
      </table></div>`;
  }

  main.querySelector('#filters').addEventListener('input', (e) => {
    state[e.target.name] = e.target.value.trim();
    refresh();
  });
  main.querySelector('#filters').addEventListener('submit', (e) => e.preventDefault());
  main.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      main.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      refresh();
    }),
  );

  main.querySelector('#new').addEventListener('click', () =>
    formDialog({
      title: 'Crear espacio',
      fields: spaceForm(),
      submitLabel: 'Crear espacio',
      onSubmit: async (data) => {
        const s = await api('/spaces', { method: 'POST', body: data });
        toast(`Espacio ${s.code} creado`);
        refresh();
      },
    }),
  );

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.edit) {
        const s = await api(`/spaces/${b.dataset.edit}`);
        formDialog({
          title: `Editar ${s.code}`,
          fields: spaceForm(s),
          submitLabel: 'Guardar cambios',
          onSubmit: async (data) => {
            await api(`/spaces/${s.id}`, { method: 'PATCH', body: data });
            toast(`Cambios de ${data.code.toUpperCase()} guardados`);
            refresh();
          },
        });
      } else if (b.dataset.disable || b.dataset.enable) {
        const outOfService = Boolean(b.dataset.disable);
        const ok = await confirmDialog({
          title: outOfService ? `Poner ${b.dataset.code} fuera de servicio` : `Habilitar ${b.dataset.code}`,
          text: outOfService ? 'El espacio no aceptará entradas ni reservas hasta que lo habilites.' : 'El espacio volverá a estar disponible.',
          confirmLabel: outOfService ? 'Poner fuera de servicio' : 'Habilitar',
          danger: outOfService,
        });
        if (!ok) return;
        await api(`/spaces/${b.dataset.disable || b.dataset.enable}/maintenance`, { method: 'PATCH', body: { outOfService } });
        toast(outOfService ? `${b.dataset.code} fuera de servicio` : `${b.dataset.code} habilitado`);
        refresh();
      }
    } catch (err) {
      toast(err.message, 'error');
      refresh();
    }
  });

  await refresh();
  const timer = setInterval(() => !document.getElementById('dialog').open && refresh(), 10_000);
  return () => clearInterval(timer);
}
