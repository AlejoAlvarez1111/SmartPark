import { api, query, ApiError } from '../api.js';
import { html, badge, loading, errorBox, empty, fmtDate, toast, confirmDialog, formDialog, field, toLocalInput, label, countCaption } from '../ui.js';

const STATUSES = ['CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA'];

async function openCreate(onDone) {
  const [vehicles, spaces] = await Promise.all([api('/vehicles?status=ACTIVO&limit=100'), api('/spaces')]);
  const start = new Date(Date.now() + 15 * 60_000);
  const end = new Date(start.getTime() + 2 * 3600_000);
  const options = spaces
    .filter((s) => s.status !== 'FUERA_DE_SERVICIO')
    .map((s) => [s.id, `${s.code} (zona ${s.zone}, ${label(s.spaceType).toLowerCase()}) ${s.status === 'DISPONIBLE' ? '' : `– ${label(s.status).toLowerCase()} ahora`}`]);
  const form = formDialog({
    title: 'Crear reserva',
    description: 'Las horas se muestran en tu hora local.',
    fields: [
      field({ name: 'plate', label: 'Placa del vehículo', required: true, attrs: 'list="plates" maxlength="10" autocomplete="off"', hint: 'Solo vehículos activos.' }),
      html`<datalist id="plates">${vehicles.items.map((v) => html`<option value="${v.plate}">`)}</datalist>`,
      field({ name: 'spaceId', label: 'Espacio', options: [['', 'Elige un espacio'], ...options], required: true }),
      field({ name: 'startAt', label: 'Inicio', type: 'datetime-local', value: toLocalInput(start), required: true }),
      field({ name: 'endAt', label: 'Fin', type: 'datetime-local', value: toLocalInput(end), required: true }),
    ],
    submitLabel: 'Crear reserva',
    onSubmit: async (data) => {
      const plate = data.plate.trim().toUpperCase().replace(/[\s-]/g, '');
      const vehicle = vehicles.items.find((v) => v.plate === plate);
      if (!vehicle) throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos.', [{ field: 'plate', message: `No hay un vehículo activo con la placa ${plate}. Regístralo en Vehículos.` }]);
      const startAt = new Date(data.startAt);
      const endAt = new Date(data.endAt);
      if (endAt <= startAt) throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos.', [{ field: 'endAt', message: 'El fin debe ser posterior al inicio.' }]);
      const r = await api('/reservations', {
        method: 'POST',
        body: { vehicleId: vehicle.id, spaceId: data.spaceId, startAt: startAt.toISOString(), endAt: endAt.toISOString() },
      });
      toast(`Reserva ${r.code} creada para ${r.plate} en ${r.spaceCode}`);
      if (r.spaceSync === 'PENDIENTE') toast('El espacio se actualizará en cuanto el servicio de espacios responda.', 'error');
      onDone();
    },
  });
  return form;
}

function detail(r) {
  const d = document.getElementById('dialog');
  d.innerHTML = html`<div class="dialog-body">
      <div><h2>Reserva ${r.code}</h2></div>
      <dl class="form-grid">
        <div><dt class="muted small">Estado</dt><dd>${badge(r.status)}</dd></div>
        <div><dt class="muted small">Vehículo</dt><dd>${r.plate}</dd></div>
        <div><dt class="muted small">Espacio</dt><dd>${r.spaceCode}</dd></div>
        <div><dt class="muted small">Creada</dt><dd>${fmtDate(r.createdAt)}</dd></div>
        <div><dt class="muted small">Inicio</dt><dd>${fmtDate(r.startAt)}</dd></div>
        <div><dt class="muted small">Fin</dt><dd>${fmtDate(r.endAt)}</dd></div>
        ${r.cancelledAt ? html`<div><dt class="muted small">Cancelada</dt><dd>${fmtDate(r.cancelledAt)}</dd></div>` : ''}
      </dl>
      <div class="btn-row"><button class="btn" data-close>Cerrar</button></div>
    </div>`.s;
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.showModal();
}

export async function mount(main) {
  const state = { status: '', date: '', plate: '' };
  main.innerHTML = html`<div class="page-head">
      <div><h1>Reservas</h1><p>Reservas de espacios por intervalo de tiempo.</p></div>
      <button class="btn btn-primary" id="new">Crear reserva</button>
    </div>
    <section class="panel stack">
      <form class="filters" id="filters" aria-label="Filtrar reservas">
        <div class="field"><label for="rs">Estado</label><select id="rs" name="status"><option value="">Todos</option>${STATUSES.map((s) => html`<option value="${s}">${label(s)}</option>`)}</select></div>
        <div class="field"><label for="rd">Fecha</label><input id="rd" name="date" type="date"></div>
        <div class="field"><label for="rp">Placa</label><input id="rp" name="plate" maxlength="10" autocomplete="off" placeholder="Ej. ABC123"></div>
      </form>
      <div id="list">${loading()}</div>
    </section>`.s;
  const list = main.querySelector('#list');
  let rows = [];

  async function refresh() {
    try {
      // La fecha elegida es un día local: se envía como rango from/to en UTC
      const from = state.date ? new Date(`${state.date}T00:00`) : null;
      const to = from ? new Date(from.getTime() + 86_400_000) : null;
      const { items, total } = await api(
        '/reservations' + query({ status: state.status, plate: state.plate, from: from?.toISOString(), to: to?.toISOString(), limit: 100 }),
      );
      rows = items;
      if (!items.length) {
        list.innerHTML = empty('No hay reservas con estos filtros.', html`<button class="btn" data-create>Crear reserva</button>`).s;
        return;
      }
      list.innerHTML = html`<div class="table-wrap"><table>
          <caption>${countCaption(items.length, total, 'reserva', 'reservas')}</caption>
          <thead><tr><th scope="col">Código</th><th scope="col">Placa</th><th scope="col">Espacio</th><th scope="col">Inicio</th><th scope="col">Fin</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${items.map(
            (r) => html`<tr>
                <td class="code">${r.code}</td><td>${r.plate}</td><td>${r.spaceCode}</td><td>${fmtDate(r.startAt)}</td><td>${fmtDate(r.endAt)}</td><td>${badge(r.status)}</td>
                <td class="actions">
                  <button class="btn btn-small" data-detail="${r.id}">Ver</button>
                  <button class="btn btn-small" data-complete="${r.id}" ${['CONFIRMADA', 'EN_CURSO'].includes(r.status) ? '' : 'disabled'}>Completar</button>
                  <button class="btn btn-small btn-danger" data-cancel="${r.id}" ${r.status === 'CONFIRMADA' ? '' : html`disabled title="Solo se cancelan reservas confirmadas"`}>Cancelar</button>
                </td>
              </tr>`,
          )}</tbody>
        </table></div>`.s;
    } catch (err) {
      list.innerHTML = errorBox(err).s;
    }
  }

  const create = () => openCreate(refresh).catch((err) => toast(err.message, 'error'));
  main.querySelector('#new').addEventListener('click', create);
  main.querySelector('#filters').addEventListener('input', (e) => {
    state[e.target.name] = e.target.value.trim();
    refresh();
  });
  main.querySelector('#filters').addEventListener('submit', (e) => e.preventDefault());

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.create !== undefined) return create();
    const r = rows.find((x) => x.id === (b.dataset.detail || b.dataset.cancel || b.dataset.complete));
    if (b.dataset.detail) return detail(r);
    const cancel = Boolean(b.dataset.cancel);
    const ok = await confirmDialog({
      title: cancel ? `Cancelar la reserva ${r.code}` : `Completar la reserva ${r.code}`,
      text: cancel
        ? `${r.plate} en ${r.spaceCode}, ${fmtDate(r.startAt)}. El espacio quedará libre para ese horario.`
        : `Marca la reserva de ${r.plate} en ${r.spaceCode} como completada.`,
      confirmLabel: cancel ? 'Cancelar reserva' : 'Completar reserva',
      danger: cancel,
    });
    if (!ok) return;
    try {
      const updated = await api(`/reservations/${r.id}/${cancel ? 'cancel' : 'complete'}`, { method: 'POST' });
      toast(`Reserva ${updated.code} ${cancel ? 'cancelada' : 'completada'}`);
    } catch (err) {
      toast(err.message, 'error');
    }
    refresh();
  });

  await refresh();
}
