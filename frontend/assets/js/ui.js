// Utilidades de interfaz compartidas por las vistas

// ---------- HTML seguro ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(s);
const render = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join('') : esc(v));

// Plantilla con escape automático de cada valor interpolado; html`` anidado no se vuelve a escapar
export const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ''), ''));

// ---------- Estados ----------
export const STATUS = {
  DISPONIBLE: { label: 'Disponible', icon: '✓' },
  OCUPADO: { label: 'Ocupado', icon: '■' },
  RESERVADO: { label: 'Reservado', icon: '◆' },
  FUERA_DE_SERVICIO: { label: 'Fuera de servicio', icon: '⊘' },
};
const LABELS = {
  ...Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label])),
  ACTIVO: 'Activo',
  INACTIVO: 'Inactivo',
  CONFIRMADA: 'Confirmada',
  EN_CURSO: 'En curso',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
  EXPIRADA: 'Expirada',
  PROCESADO: 'Procesado',
  RECHAZADO: 'Rechazado',
  FALLIDO: 'Fallido',
  PENDIENTE: 'Pendiente',
  UP: 'Activo',
  DEGRADED: 'Degradado',
  DOWN: 'Sin respuesta',
  VEHICLE_ENTERED: 'Entrada',
  VEHICLE_EXITED: 'Salida',
  ESTANDAR: 'Estándar',
  ACCESIBLE: 'Accesible',
  MOTO: 'Moto',
  CARRO: 'Carro',
  BICICLETA: 'Bicicleta',
};
export const label = (v) => LABELS[v] ?? v;
const ICONS = { ...Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.icon])), UP: '✓', DOWN: '✕', DEGRADED: '!', PROCESADO: '✓', RECHAZADO: '✕', FALLIDO: '!' };
export const badge = (status) => html`<span class="badge s-${status}">${ICONS[status] ? html`<span aria-hidden="true">${ICONS[status]}</span>` : ''}${label(status)}</span>`;

export const legend = () =>
  html`<ul class="legend" aria-label="Leyenda de estados">${Object.keys(STATUS).map((s) => html`<li>${badge(s)}</li>`)}</ul>`;

// "1 reserva", "3 reservas"
export const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const countCaption = (shown, total, one, many) => (shown === total ? count(total, one, many) : `Mostrando ${shown} de ${count(total, one, many)}`);

// ---------- Fechas (UTC en backend, hora local aquí) ----------
const dateFmt = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '—');
// Valor para <input type="datetime-local"> en hora local
export const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

// ---------- Estados de carga / vacío / error ----------
export const loading = (text = 'Cargando…') => html`<div class="state loading" role="status">${text}</div>`;
export const empty = (text, action = '') => html`<div class="state"><p>${text}</p>${action}</div>`;
export const errorBox = (err) =>
  html`<div class="notice error" role="alert"><strong>${err.status === 503 || err.code === 'NETWORK' ? 'Servicio no disponible.' : 'No se pudo completar la operación.'}</strong> ${err.message}</div>`;

// ---------- Avisos ----------
export function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 4000);
}

// ---------- Diálogos ----------
const dialog = () => document.getElementById('dialog');

export function confirmDialog({ title, text, confirmLabel, danger = false }) {
  const d = dialog();
  d.innerHTML = html`<form method="dialog">
      <div><h2>${title}</h2></div>
      <p>${text}</p>
      <div class="btn-row">
        <button type="button" class="btn" data-cancel>Volver</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="ok">${confirmLabel}</button>
      </div>
    </form>`.s;
  // "Volver" no es botón de envío: Enter confirma y Escape cancela
  d.querySelector('[data-cancel]').addEventListener('click', () => d.close('cancel'));
  d.returnValue = '';
  d.showModal();
  d.querySelector('[value="ok"]').focus();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

/**
 * Diálogo de formulario. onSubmit(datos) puede lanzar ApiError: se muestra en el diálogo
 * y los errores por campo (error.details) se marcan junto a cada campo.
 */
export function formDialog({ title, description = '', fields, submitLabel, onSubmit }) {
  const d = dialog();
  d.innerHTML = html`<form novalidate>
      <div><h2>${title}</h2>${description ? html`<p class="muted small">${description}</p>` : ''}</div>
      <div class="form-error" aria-live="assertive"></div>
      <div class="form-grid">${fields}</div>
      <div class="btn-row">
        <button type="button" class="btn" data-close>Volver</button>
        <button type="submit" class="btn btn-primary">${submitLabel}</button>
      </div>
    </form>`.s;
  const form = d.querySelector('form');
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    if (!form.checkValidity()) {
      markNativeErrors(form);
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)), form);
      d.close();
    } catch (err) {
      showFormError(form, err);
    } finally {
      submit.disabled = false;
    }
  });
  d.showModal();
  form.querySelector('input, select')?.focus();
  return form;
}

export const field = ({ name, label: text, type = 'text', value = '', required = false, hint = '', attrs = '', options, full = false }) => {
  const id = `f-${name}`;
  const control = options
    ? html`<select id="${id}" name="${name}" ${required ? raw('required') : ''} ${raw(attrs)}>${options.map(
        ([v, t]) => html`<option value="${v}" ${String(v) === String(value) ? raw('selected') : ''}>${t}</option>`,
      )}</select>`
    : html`<input id="${id}" name="${name}" type="${type}" value="${value}" ${required ? raw('required') : ''} ${raw(attrs)}>`;
  return html`<div class="field ${full ? 'full' : ''}">
      <label for="${id}">${text}${required ? '' : html` <span class="muted">(opcional)</span>`}</label>
      ${control}
      ${hint ? html`<span class="hint">${hint}</span>` : ''}
      <span class="error" id="${id}-error"></span>
    </div>`;
};

function clearFieldErrors(form) {
  form.querySelector('.form-error').innerHTML = '';
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field .error').forEach((el) => (el.textContent = ''));
}

function setFieldError(form, name, message) {
  const el = form.elements[name];
  if (!el) return false;
  el.setAttribute('aria-invalid', 'true');
  el.setAttribute('aria-describedby', `f-${name}-error`);
  form.querySelector(`#f-${name}-error`).textContent = message;
  return true;
}

function markNativeErrors(form) {
  const invalid = [...form.elements].filter((el) => el.willValidate && !el.checkValidity());
  invalid.forEach((el) => setFieldError(form, el.name, el.validationMessage));
  invalid[0]?.focus();
}

export function showFormError(form, err) {
  const unmatched = (Array.isArray(err.details) ? err.details : []).filter((d) => !setFieldError(form, d.field, d.message));
  const extra = unmatched.map((d) => d.message).join(' ');
  form.querySelector('.form-error').innerHTML = errorBox({ ...err, message: `${err.message}${extra ? ` ${extra}` : ''}` }).s;
}

// Parámetros del hash: #vehiculos?plate=ABC123 -> { plate: 'ABC123' }
export const hashParams = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] ?? ''));
