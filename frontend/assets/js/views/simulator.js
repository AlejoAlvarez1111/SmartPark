import { api, request } from '../api.js';
import { html, badge, loading, errorBox, empty, fmtTime, fmtDate, label, toast, confirmDialog, hashParams } from '../ui.js';
import { openRegister } from './vehicles.js';

const REFRESH_MS = 5000;
const normPlate = (p) => p.trim().toUpperCase().replace(/[\s-]/g, '');

export async function mount(main) {
  main.innerHTML = html`<div class="page-head">
      <div><h1>Simulador de sensores</h1><p>Genera eventos de entrada y salida como si vinieran de un sensor del espacio.</p></div>
    </div>
    <div class="cols">
      <div class="stack">
        <section class="panel stack" aria-labelledby="ctl-title">
          <h2 id="ctl-title">Evento manual</h2>
          <form class="form-grid" id="sim" novalidate>
            <div class="field full"><label for="sp">Espacio</label><select id="sp" name="spaceId" required></select></div>
            <div class="field full" id="space-info" aria-live="polite"></div>
            <div class="field full">
              <label for="pl">Placa del vehículo (para la entrada)</label>
              <input id="pl" name="plate" list="sim-plates" maxlength="10" autocomplete="off" placeholder="Ej. ABC123">
              <datalist id="sim-plates"></datalist>
            </div>
            <div class="btn-row full">
              <button type="button" class="btn btn-primary" id="entry">Simular entrada</button>
              <button type="button" class="btn" id="exit">Simular salida</button>
              <button type="button" class="btn" id="resend" disabled title="Envía otra vez el último evento con el mismo eventId">Reenviar último evento</button>
            </div>
          </form>
          <div id="result" aria-live="polite"></div>
        </section>

        <section class="panel stack" aria-labelledby="auto-title">
          <h2 id="auto-title">Modo automático</h2>
          <p class="small muted">Genera entradas y salidas al azar con vehículos activos y espacios libres u ocupados.</p>
          <div class="filters">
            <div class="field"><label for="iv">Intervalo (segundos)</label><input id="iv" type="number" min="2" max="60" value="4"></div>
            <button type="button" class="btn btn-primary" id="auto">Iniciar</button>
          </div>
          <p class="small" id="auto-status" aria-live="polite"></p>
        </section>
      </div>

      <section class="panel" aria-labelledby="log-title">
        <div class="panel-head"><h2 id="log-title">Bitácora de eventos</h2><span class="small muted" id="log-updated"></span></div>
        <div id="log">${loading()}</div>
      </section>
    </div>`.s;

  const $ = (sel) => main.querySelector(sel);
  const spaceSelect = $('#sp');
  const plateInput = $('#pl');
  let spaces = [];
  let vehicles = [];
  let lastEvent = null; // { path, body } para demostrar la idempotencia
  let autoTimer = null;
  let autoCount = 0;

  const plateOf = (id) => vehicles.find((v) => v.id === id)?.plate;
  const selected = () => spaces.find((s) => s.id === spaceSelect.value);

  async function loadData() {
    const [s, v] = await Promise.all([api('/spaces'), api('/vehicles?limit=100')]);
    spaces = s;
    vehicles = v.items;
    const current = spaceSelect.value || hashParams().space;
    // No redibujar el selector mientras el usuario lo está usando
    if (document.activeElement !== spaceSelect) spaceSelect.innerHTML = html`${spaces.map(
      (sp) => html`<option value="${sp.id}" ${sp.id === current ? 'selected' : ''}>${sp.code}: ${label(sp.status).toLowerCase()}</option>`,
    )}`.s;
    $('#sim-plates').innerHTML = html`${vehicles.filter((x) => x.status === 'ACTIVO').map((x) => html`<option value="${x.plate}">`)}`.s;
    showSpace();
  }

  function showSpace() {
    const s = selected();
    if (!s) return;
    const info =
      s.status === 'OCUPADO'
        ? `Ocupado por ${plateOf(s.occupancy.vehicleId) ?? 'un vehículo'} desde el ${fmtDate(s.occupancy.entryAt)}`
        : s.status === 'RESERVADO'
          ? `Solo puede entrar ${plateOf(s.nextReservation.vehicleId) ?? 'el vehículo de la reserva'}, reservado desde el ${fmtDate(s.nextReservation.startAt)}`
          : s.status === 'FUERA_DE_SERVICIO'
            ? 'Fuera de servicio: no acepta entradas.'
            : 'Libre: acepta entradas.';
    $('#space-info').innerHTML = html`<div>${badge(s.status)} <span class="small">${info}</span></div>`.s;
    // Acciones que no corresponden al estado quedan deshabilitadas (§11.4)
    $('#entry').disabled = ['OCUPADO', 'FUERA_DE_SERVICIO'].includes(s.status);
    $('#exit').disabled = s.status !== 'OCUPADO';
  }

  async function loadLog() {
    try {
      const events = await api('/sensors/events?limit=20');
      $('#log-updated').textContent = `Actualizada a las ${fmtTime(new Date().toISOString())}`;
      $('#log').innerHTML = (events.length
        ? html`<div class="table-wrap"><table>
            <thead><tr><th scope="col">Hora</th><th scope="col">Tipo</th><th scope="col">Espacio</th><th scope="col">Placa</th><th scope="col">Resultado</th></tr></thead>
            <tbody>${events.map(
              (e) => html`<tr>
                  <td>${fmtTime(e.createdAt)}</td>
                  <td>${label(e.eventType)}${e.source === 'AUTO' ? html` <span class="muted small">(auto)</span>` : ''}</td>
                  <td>${e.spaceCode ?? '—'}</td><td>${e.plate ?? '—'}</td>
                  <td>${badge(e.status)}<div class="small muted">${e.message ?? ''}</div></td>
                </tr>`,
            )}</tbody></table></div>`
        : empty('Todavía no hay eventos. Simula la primera entrada.')).s;
    } catch (err) {
      $('#log').innerHTML = errorBox(err).s;
    }
  }

  function showResult(kind, text, extra = '') {
    $('#result').innerHTML = html`<div class="notice ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${text}${extra}</div>`.s;
  }

  // Envía un evento y muestra el resultado. Devuelve true si el efecto se aplicó.
  async function send(path, body, { quiet = false } = {}) {
    lastEvent = { path, body };
    $('#resend').disabled = false;
    try {
      const res = await request(path, { method: 'POST', body });
      if (!quiet) showResult('ok', res.data.duplicate ? res.message : res.data.event.message);
      return true;
    } catch (err) {
      if (quiet) return false;
      const plate = err.details?.event?.plate ?? normPlate(plateInput.value);
      showResult(
        err.status === 503 ? 'warn' : 'error',
        `${err.message}${err.code === 'DEPENDENCY_UNAVAILABLE' ? ' Puedes reenviar el mismo evento cuando el servicio vuelva.' : ''}`,
        err.code === 'VEHICLE_NOT_FOUND' ? html` <button type="button" class="btn btn-small" data-register="${plate}">Registrar ${plate}</button>` : '',
      );
      return false;
    } finally {
      await Promise.all([loadData().catch(() => {}), loadLog()]);
    }
  }

  const event = (s, extra) => ({ eventId: crypto.randomUUID(), sensorId: `SIM-SENSOR-${s.code}`, spaceId: s.id, ...extra });

  $('#entry').addEventListener('click', async () => {
    const s = selected();
    const plate = normPlate(plateInput.value);
    plateInput.removeAttribute('aria-invalid');
    if (!plate) {
      plateInput.setAttribute('aria-invalid', 'true');
      showResult('error', 'Escribe la placa del vehículo que entra.');
      plateInput.focus();
      return;
    }
    let vehicle = vehicles.find((v) => v.plate === plate);
    if (!vehicle) {
      vehicle = await api(`/vehicles/plate/${encodeURIComponent(plate)}`).catch(() => null);
      if (!vehicle) {
        showResult('error', `El vehículo ${plate} no está registrado.`, html` <button type="button" class="btn btn-small" data-register="${plate}">Registrar ${plate}</button>`);
        return;
      }
    }
    await send('/sensors/events/entry', event(s, { vehicleId: vehicle.id }));
  });

  $('#exit').addEventListener('click', async () => {
    const s = selected();
    const plate = plateOf(s.occupancy?.vehicleId) ?? 'el vehículo';
    const ok = await confirmDialog({ title: `Simular salida de ${s.code}`, text: `Se registrará la salida de ${plate} y el espacio quedará libre.`, confirmLabel: 'Simular salida' });
    if (ok) await send('/sensors/events/exit', event(s));
  });

  $('#resend').addEventListener('click', () => lastEvent && send(lastEvent.path, lastEvent.body));
  spaceSelect.addEventListener('change', showSpace);
  $('#result').addEventListener('click', (e) => {
    const b = e.target.closest('[data-register]');
    if (b) openRegister(b.dataset.register, async (v) => {
      await loadData();
      plateInput.value = v.plate;
      showResult('ok', `${v.plate} registrado. Ya puedes simular su entrada.`);
    });
  });

  // ---------- Modo automático ----------
  async function autoTick() {
    try {
      const [s, v] = await Promise.all([api('/spaces'), api('/vehicles?status=ACTIVO&limit=100')]);
      const occupied = s.filter((x) => x.status === 'OCUPADO');
      const free = s.filter((x) => x.status === 'DISPONIBLE');
      const parked = new Set(occupied.map((x) => x.occupancy.vehicleId));
      const idle = v.items.filter((x) => !parked.has(x.id));
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      const doExit = occupied.length && (Math.random() < 0.45 || !free.length || !idle.length);
      if (doExit) await send('/sensors/events/exit', event(pick(occupied), { source: 'AUTO' }), { quiet: true });
      else if (free.length && idle.length) await send('/sensors/events/entry', event(pick(free), { vehicleId: pick(idle).id, source: 'AUTO' }), { quiet: true });
      autoCount++;
      $('#auto-status').textContent = `Activo: ${autoCount} eventos generados.`;
    } catch (err) {
      $('#auto-status').textContent = `Activo, último intento sin éxito: ${err.message}`;
    }
  }

  function stopAuto() {
    clearInterval(autoTimer);
    autoTimer = null;
    $('#auto').textContent = 'Iniciar';
    $('#auto').classList.add('btn-primary');
    $('#iv').disabled = false;
  }

  $('#auto').addEventListener('click', () => {
    if (autoTimer) {
      stopAuto();
      $('#auto-status').textContent = `Detenido tras ${autoCount} eventos.`;
      return;
    }
    const seconds = Math.min(60, Math.max(2, Number($('#iv').value) || 4));
    $('#iv').value = seconds;
    $('#iv').disabled = true;
    autoCount = 0;
    autoTimer = setInterval(autoTick, seconds * 1000);
    $('#auto').textContent = 'Detener';
    $('#auto').classList.remove('btn-primary');
    $('#auto-status').textContent = `Activo: un evento cada ${seconds} s.`;
    autoTick();
  });

  try {
    await loadData();
  } catch (err) {
    showResult('error', err.message);
  }
  await loadLog();
  const timer = setInterval(() => {
    if (document.getElementById('dialog').open) return;
    loadData().catch(() => {});
    loadLog();
  }, REFRESH_MS);
  return () => {
    clearInterval(timer);
    stopAuto();
  };
}
