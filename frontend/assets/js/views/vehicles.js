import { api, query } from '../api.js';
import { html, badge, loading, errorBox, empty, label, toast, confirmDialog, formDialog, field, hashParams, countCaption } from '../ui.js';

const TYPES = [['CARRO', 'Carro'], ['MOTO', 'Moto'], ['BICICLETA', 'Bicicleta']];

function vehicleForm(v = {}) {
  return [
    field({ name: 'plate', label: 'Placa', value: v.plate ?? '', required: true, hint: 'De 4 a 8 letras o números. Se guarda en mayúsculas.', attrs: 'maxlength="10" autocomplete="off" pattern="[A-Za-z0-9 \\-]{4,10}"' }),
    field({ name: 'vehicleType', label: 'Tipo', value: v.vehicleType ?? 'CARRO', options: TYPES, required: true }),
    field({ name: 'brand', label: 'Marca', value: v.brand ?? '', attrs: 'maxlength="60"' }),
    field({ name: 'color', label: 'Color', value: v.color ?? '', attrs: 'maxlength="30"' }),
  ];
}

// También se usa desde el simulador cuando una placa no existe
export function openRegister(plate = '', onDone) {
  formDialog({
    title: 'Registrar vehículo',
    fields: vehicleForm({ plate }),
    submitLabel: 'Registrar vehículo',
    onSubmit: async (data) => {
      const v = await api('/vehicles', { method: 'POST', body: data });
      toast(`Vehículo ${v.plate} registrado`);
      onDone?.(v);
    },
  });
}

export async function mount(main) {
  const state = { search: '', status: '' };
  main.innerHTML = html`<div class="page-head">
      <div><h1>Vehículos</h1><p>Registro de vehículos por placa.</p></div>
      <button class="btn btn-primary" id="new">Registrar vehículo</button>
    </div>
    <section class="panel stack">
      <form class="filters" id="filters" role="search" aria-label="Buscar vehículos">
        <div class="field"><label for="fq">Placa</label><input id="fq" name="search" maxlength="10" placeholder="Ej. ABC123" autocomplete="off"></div>
        <div class="field"><label for="fst">Estado</label><select id="fst" name="status"><option value="">Todos</option><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option></select></div>
      </form>
      <div id="list">${loading()}</div>
    </section>`.s;
  const list = main.querySelector('#list');

  async function refresh() {
    try {
      const { items, total } = await api('/vehicles' + query({ search: state.search, status: state.status, limit: 100 }));
      if (!items.length) {
        list.innerHTML = (state.search
          ? empty(`No hay vehículos con la placa ${state.search.toUpperCase()}.`, html`<button class="btn btn-primary" data-register="${state.search}">Registrar ${state.search.toUpperCase()}</button>`)
          : empty('Aún no hay vehículos registrados.')).s;
        return;
      }
      list.innerHTML = html`<div class="table-wrap"><table>
          <caption>${countCaption(items.length, total, 'vehículo', 'vehículos')}</caption>
          <thead><tr><th scope="col">Placa</th><th scope="col">Tipo</th><th scope="col">Marca</th><th scope="col">Color</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${items.map(
            (v) => html`<tr>
                <td class="code">${v.plate}</td><td>${label(v.vehicleType)}</td><td>${v.brand ?? '—'}</td><td>${v.color ?? '—'}</td><td>${badge(v.status)}</td>
                <td class="actions">
                  <button class="btn btn-small" data-edit="${v.id}">Editar</button>
                  <button class="btn btn-small ${v.status === 'ACTIVO' ? 'btn-danger' : ''}" data-toggle="${v.id}" data-plate="${v.plate}" data-status="${v.status}">${v.status === 'ACTIVO' ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>`,
          )}</tbody>
        </table></div>`.s;
    } catch (err) {
      list.innerHTML = errorBox(err).s;
    }
  }

  main.querySelector('#filters').addEventListener('input', (e) => {
    state[e.target.name] = e.target.value.replace(/[\s-]/g, '');
    refresh();
  });
  main.querySelector('#filters').addEventListener('submit', (e) => e.preventDefault());
  main.querySelector('#new').addEventListener('click', () => openRegister('', refresh));

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.register !== undefined) openRegister(b.dataset.register.toUpperCase(), refresh);
      if (b.dataset.edit) {
        const v = await api(`/vehicles/${b.dataset.edit}`);
        formDialog({
          title: `Editar ${v.plate}`,
          fields: vehicleForm(v),
          submitLabel: 'Guardar cambios',
          onSubmit: async (data) => {
            const saved = await api(`/vehicles/${v.id}`, { method: 'PATCH', body: data });
            toast(`Cambios de ${saved.plate} guardados`);
            refresh();
          },
        });
      }
      if (b.dataset.toggle) {
        const deactivate = b.dataset.status === 'ACTIVO';
        if (deactivate) {
          const ok = await confirmDialog({
            title: `Desactivar ${b.dataset.plate}`,
            text: 'Un vehículo inactivo no puede entrar ni reservar. Su historial se conserva.',
            confirmLabel: 'Desactivar',
            danger: true,
          });
          if (!ok) return;
        }
        await api(`/vehicles/${b.dataset.toggle}/status`, { method: 'PATCH', body: { status: deactivate ? 'INACTIVO' : 'ACTIVO' } });
        toast(`${b.dataset.plate} ${deactivate ? 'desactivado' : 'activado'}`);
        refresh();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await refresh();
  // Llegada desde el simulador: #vehiculos?new=1&plate=XYZ123
  const params = hashParams();
  if (params.new) openRegister(params.plate ?? '', refresh);
}
