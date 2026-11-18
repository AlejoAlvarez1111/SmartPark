// Plano del parqueadero: los espacios se dibujan como cajones pintados sobre asfalto, agrupados por zona
import { html, label, STATUS, fmtTime } from './ui.js';

const TYPE_MARK = { ACCESIBLE: '♿ Accesible', MOTO: 'Moto', ESTANDAR: '' };

// plates: Map(vehicleId -> placa), opcional, para mostrar quién ocupa o reservó
function bay(space, plates) {
  const st = STATUS[space.status];
  const who = space.occupancy ? plates?.get(space.occupancy.vehicleId) : space.nextReservation ? plates?.get(space.nextReservation.vehicleId) : null;
  const detail =
    space.status === 'OCUPADO'
      ? `${who ?? ''} desde ${fmtTime(space.occupancy.entryAt).slice(0, 5)}`
      : space.status === 'RESERVADO'
        ? `${who ?? ''} a las ${fmtTime(space.nextReservation.startAt).slice(0, 5)}`
        : '';
  const aria = [space.code, st.label, label(space.spaceType), detail].filter(Boolean).join(', ');
  return html`<a class="bay s-${space.status}" href="#simulador?space=${space.id}" aria-label="${aria}" title="Abrir en el simulador">
      <span>
        <span class="bay-code">${space.code}</span>
        <span class="bay-type">${TYPE_MARK[space.spaceType] ? html`<br>${TYPE_MARK[space.spaceType]}` : ''}</span>
      </span>
      <span class="bay-chip"><span aria-hidden="true">${st.icon}</span><span>${st.label}${detail ? html`<small>${detail.trim()}</small>` : ''}</span></span>
    </a>`;
}

export function lotMap(spaces, plates) {
  const zones = new Map();
  for (const s of spaces) zones.set(s.zone, [...(zones.get(s.zone) ?? []), s]);
  return html`<div class="lot">
      ${[...zones].map(
        ([zone, list]) => html`<section class="lot-zone" aria-label="Zona ${zone}">
            <h3>Zona ${zone} <span>${list.filter((s) => s.status === 'DISPONIBLE').length} de ${list.length} libres</span></h3>
            <div class="bays">${list.map((s) => bay(s, plates))}</div>
          </section>`,
      )}
    </div>`;
}

// Mapa id -> placa a partir del listado de vehículos (para el plano y las tablas)
export const platesById = (vehicles) => new Map((vehicles ?? []).map((v) => [v.id, v.plate]));
