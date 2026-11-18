# API de SmartPark

Base pública: `http://localhost:3000/api/v1` (gateway). Cada servicio expone las mismas rutas en su propio puerto para pruebas y comunicación interna.
Todas las respuestas son JSON e incluyen `requestId` (también en la cabecera `X-Request-ID`).

## Formato

Éxito:
```json
{ "success": true, "data": {}, "message": "Operación realizada correctamente", "requestId": "uuid" }
```

Error:
```json
{ "success": false, "error": { "code": "SPACE_NOT_AVAILABLE", "message": "El espacio seleccionado no está disponible" }, "requestId": "uuid" }
```

## Códigos de error

| Código | HTTP | Significado |
|---|---|---|
| VALIDATION_ERROR | 400 | Datos de entrada inválidos (incluye JSON mal formado). `error.details` lista los campos. |
| NOT_FOUND | 404 | Ruta inexistente. |
| VEHICLE_NOT_FOUND | 404 | Vehículo inexistente. |
| VEHICLE_ALREADY_EXISTS | 409 | Ya hay un vehículo con esa placa. |
| SPACE_NOT_FOUND | 404 | Espacio inexistente. |
| SPACE_CODE_EXISTS | 409 | Ya hay un espacio con ese código. |
| VEHICLE_ALREADY_PARKED | 409 | El vehículo ya ocupa otro espacio. |
| VEHICLE_INACTIVE | 409 | El vehículo está desactivado. |
| RESERVATION_NOT_FOUND | 404 | Reserva inexistente. |
| SPACE_NOT_AVAILABLE | 409 | Espacio ocupado, reservado o fuera de servicio. |
| RESERVATION_CONFLICT | 409 | Existe una reserva superpuesta. |
| INVALID_STATE_TRANSITION | 409 | Cambio de estado no permitido. |
| DUPLICATE_EVENT | 200 / 409 | Evento ya recibido: 200 con el resultado original si se procesó; 409 si está en proceso o el `eventId` se usó para otro evento. |
| DEPENDENCY_UNAVAILABLE | 503 | Un servicio requerido no responde (timeout o conexión rechazada). |
| INTERNAL_ERROR | 500 | Error no controlado (el detalle solo queda en los logs). |

## Health checks

### `GET /health` (cada servicio)

`200` si la base de datos responde, `503` si no.
```json
{ "success": true, "data": { "service": "vehicles-service", "status": "UP", "version": "1.0.0", "database": "UP", "uptimeSeconds": 12, "timestamp": "2026-11-20T14:00:00.000Z" }, "requestId": "uuid" }
```
sensors-service también responde en `GET /api/v1/sensors/health`.

### `GET /health` y `GET /api/v1/health` (gateway)

Siempre `200` mientras el gateway esté vivo. `status` es `UP` si todos los servicios están `UP`, si no `DEGRADED`. Un servicio que no responde aparece como `DOWN`.
```json
{
  "success": true,
  "data": {
    "service": "gateway", "status": "DEGRADED", "version": "1.0.0",
    "services": {
      "vehicles": { "service": "vehicles-service", "status": "UP", "database": "UP", "version": "1.0.0" },
      "spaces": { "service": "spaces-service", "status": "DOWN", "database": "DESCONOCIDO" }
    }
  }
}
```

### `GET /api/v1/dashboard` (gateway)

Reúne en una llamada lo que necesita el tablero: `{ summary, spaces, recentEvents, unavailable, generatedAt }`. Si un servicio no responde, sus partes llegan en `null` y su nombre aparece en `unavailable`; el gateway no inventa datos. Siempre responde 200 mientras el gateway esté vivo.

## Vehículos (vehicles-service :3001)

Objeto vehículo:
```json
{ "id": "uuid", "plate": "ABC123", "vehicleType": "CARRO", "brand": "Renault", "color": "Gris", "status": "ACTIVO", "createdAt": "2026-11-20T14:00:00.000Z", "updatedAt": "2026-11-20T14:00:00.000Z" }
```

Reglas:
- `plate` se normaliza: mayúsculas, sin espacios ni guiones (`" abc-123 "` → `ABC123`). Debe tener 4 a 8 letras o números y es única.
- `vehicleType`: `CARRO`, `MOTO` o `BICICLETA`. `brand` (máx. 60) y `color` (máx. 30) son opcionales; `""` se guarda como `null`.
- No hay borrado: se desactiva con `status: "INACTIVO"`.
- Campos desconocidos en el body → 400.

| Método y ruta | Uso | Respuestas |
|---|---|---|
| `GET /api/v1/vehicles` | Listar. Query: `search` (parte de la placa), `status`, `vehicleType`, `limit` (1–100, def. 50), `offset` (def. 0). Orden por placa. | 200 `{ items, total }` |
| `POST /api/v1/vehicles` | Registrar | 201, 400, 409 `VEHICLE_ALREADY_EXISTS` |
| `GET /api/v1/vehicles/:id` | Detalle | 200, 400 (id no es UUID), 404 `VEHICLE_NOT_FOUND` |
| `GET /api/v1/vehicles/plate/:plate` | Buscar por placa (se normaliza) | 200, 404 |
| `PATCH /api/v1/vehicles/:id` | Actualizar `plate`, `vehicleType`, `brand` o `color` (al menos uno) | 200, 400, 404, 409 |
| `PATCH /api/v1/vehicles/:id/status` | Activar/desactivar. Body `{ "status": "ACTIVO" \| "INACTIVO" }` | 200, 400, 404 |

Ejemplo:
```http
POST /api/v1/vehicles
{ "plate": "abc 123", "vehicleType": "CARRO", "brand": "Renault", "color": "Gris" }

201 { "success": true, "data": { "id": "…", "plate": "ABC123", "vehicleType": "CARRO", "brand": "Renault", "color": "Gris", "status": "ACTIVO", … }, "message": "Vehículo registrado correctamente", "requestId": "…" }
```

Error de validación:
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Datos de entrada inválidos",
  "details": [ { "field": "plate", "message": "La placa debe tener entre 4 y 8 letras o números" } ] }, "requestId": "…" }
```

Si MySQL no responde, cualquier ruta devuelve `503 DEPENDENCY_UNAVAILABLE` ("La base de datos no está disponible").

## Espacios (spaces-service :3002)

Objeto espacio:
```json
{
  "id": "uuid", "code": "A-01", "zone": "A", "spaceType": "ACCESIBLE", "status": "OCUPADO",
  "occupancy": { "id": "uuid", "vehicleId": "uuid", "entryAt": "2026-11-20T14:05:00.000Z", "reservationId": null },
  "nextReservation": { "id": "uuid", "vehicleId": "uuid", "startAt": "…", "endAt": "…" },
  "createdAt": "…", "updatedAt": "…"
}
```

- `status` es el estado visible: FUERA_DE_SERVICIO > OCUPADO > RESERVADO > DISPONIBLE. RESERVADO se calcula: hay una reserva CONFIRMADA en curso o que empieza dentro de `RESERVATION_HOLD_MINUTES` (60 por defecto).
- `occupancy` es la ocupación abierta (o `null`); `nextReservation`, la próxima reserva confirmada aunque todavía no bloquee. Así la interfaz distingue reserva futura de ocupación real.
- `code` se normaliza a mayúsculas (`a-01` → `A-01`) y es único. `spaceType`: `ESTANDAR`, `ACCESIBLE`, `MOTO`.

| Método y ruta | Uso | Respuestas |
|---|---|---|
| `GET /api/v1/spaces` | Listar. Query: `status`, `type`, `zone`. Orden por código. | 200 lista |
| `POST /api/v1/spaces` | Crear `{ code, zone, spaceType }` | 201, 400, 409 `SPACE_CODE_EXISTS` |
| `GET /api/v1/spaces/summary` | Conteos `{ total, byStatus, byType }` | 200 |
| `GET /api/v1/spaces/:id` | Detalle | 200, 400, 404 `SPACE_NOT_FOUND` |
| `PATCH /api/v1/spaces/:id` | Editar `code`, `zone` o `spaceType` | 200, 400, 404, 409 |
| `POST /api/v1/spaces/:id/occupy` | Entrada `{ vehicleId, eventId }` | 200, 404, 409 `SPACE_NOT_AVAILABLE` / `VEHICLE_ALREADY_PARKED` |
| `POST /api/v1/spaces/:id/release` | Salida `{ eventId }` | 200, 404, 409 `INVALID_STATE_TRANSITION` |
| `PATCH /api/v1/spaces/:id/maintenance` | `{ "outOfService": true \| false }` | 200, 404, 409 `INVALID_STATE_TRANSITION` |

Respuesta de `occupy` / `release`:
```json
{ "success": true, "data": { "duplicate": false, "occupancy": { "id": "…", "spaceId": "…", "vehicleId": "…", "reservationId": null, "entryAt": "…", "exitAt": null, "sourceEventId": "…", "exitEventId": null, "status": "ABIERTA" }, "space": { … } }, "message": "Ocupación registrada" }
```

Reglas de entrada (`occupy`):
- Rechaza (409 `SPACE_NOT_AVAILABLE`) si el espacio está FUERA_DE_SERVICIO, OCUPADO o RESERVADO para otro vehículo.
- Si está reservado para **este** vehículo, entra y la reserva pasa a EN_CURSO; al salir pasa a COMPLETADA.
- Un vehículo no puede estar en dos espacios a la vez (409 `VEHICLE_ALREADY_PARKED`).
- **Idempotencia:** repetir el mismo `eventId` devuelve 200 con `duplicate: true` y la ocupación original, sin repetir el efecto. Igual para `release`.
- **Concurrencia:** dos entradas simultáneas al mismo espacio → una 200 y otra 409; nunca dos ocupaciones abiertas.

Reglas de mantenimiento: a FUERA_DE_SERVICIO solo si no está ocupado y no tiene reservas CONFIRMADA/EN_CURSO sin terminar; de vuelta a DISPONIBLE solo desde FUERA_DE_SERVICIO.

### Rutas internas (para reservations-service)

| Método y ruta | Uso |
|---|---|
| `GET /api/v1/spaces/:id/eligibility?startAt=ISO&endAt=ISO` | `{ eligible, reason, space }`. No elegible si está fuera de servicio, o si está ocupado y la reserva empieza dentro de la ventana de retención. El solapamiento entre reservas lo valida reservations-service. |
| `PUT /api/v1/spaces/internal/reservations/:reservationId` | Copia de una reserva `{ spaceId, vehicleId, startAt, endAt, status, updatedAt }`. Idempotente: si `updatedAt` no es más nuevo que el guardado, responde `applied: false`. **El gateway no expone `/internal/`.** |

## Reservas (reservations-service :3003)

Objeto reserva:
```json
{
  "id": "uuid", "code": "R-7KQ2M9XA", "vehicleId": "uuid", "plate": "ABC123", "spaceId": "uuid", "spaceCode": "A-03",
  "startAt": "2026-11-20T14:00:00.000Z", "endAt": "2026-11-20T16:00:00.000Z", "status": "CONFIRMADA",
  "createdAt": "…", "updatedAt": "…", "cancelledAt": null,
  "spaceSync": "ENTREGADO"
}
```

- `plate` y `spaceCode` son copias tomadas al crear la reserva (para listar y filtrar sin consultar otros servicios).
- `spaceSync` (solo en respuestas de crear/cancelar/completar): resultado de avisar el cambio a spaces-service. `ENTREGADO`, `PENDIENTE` (se reintentará automáticamente), `FALLIDO` o `SIN_CAMBIOS`.
- Estados: `CONFIRMADA`, `EN_CURSO`, `COMPLETADA`, `CANCELADA`. `EXPIRADA` existe en el modelo pero no se asigna automáticamente.

| Método y ruta | Uso | Respuestas |
|---|---|---|
| `GET /api/v1/reservations` | Listar. Query: `status`, `plate`, `spaceId`, `vehicleId`, `date` (YYYY-MM-DD, día UTC) **o** `from`/`to` (ISO, reservas que se solapan con el rango), `limit`, `offset`. Orden: inicio descendente. | 200 `{ items, total }` |
| `POST /api/v1/reservations` | Crear `{ vehicleId, spaceId, startAt, endAt }` | 201, 400, 404 `VEHICLE_NOT_FOUND` / `SPACE_NOT_FOUND`, 409 `RESERVATION_CONFLICT` / `SPACE_NOT_AVAILABLE` / `VEHICLE_INACTIVE`, 503 |
| `GET /api/v1/reservations/:id` | Detalle | 200, 400, 404 `RESERVATION_NOT_FOUND` |
| `POST /api/v1/reservations/:id/cancel` | Cancelar (solo CONFIRMADA) | 200, 404, 409 `INVALID_STATE_TRANSITION` |
| `POST /api/v1/reservations/:id/complete` | Completar (CONFIRMADA o EN_CURSO) | 200, 404, 409 |
| `POST /api/v1/reservations/internal/:id/start` | **Interna** (sensors-service al entrar el titular): CONFIRMADA → EN_CURSO. El gateway no la expone. | 200, 404, 409 |

Reglas al crear:
1. `startAt < endAt`; el inicio no puede estar en el pasado (tolerancia `RESERVATION_PAST_TOLERANCE_MINUTES`, 5 por defecto).
2. El vehículo existe y está ACTIVO (consulta a vehicles-service).
3. El espacio existe y es elegible (consulta a spaces-service: no fuera de servicio ni ocupado si la reserva empieza ya).
4. No hay otra reserva CONFIRMADA o EN_CURSO del **mismo espacio** ni del **mismo vehículo** que se solape. Los intervalos son `[inicio, fin)`: una reserva que empieza justo cuando termina otra no choca.
5. Las solicitudes simultáneas para el mismo espacio se serializan: de varias reservas superpuestas a la vez, solo una se confirma.

Cancelar o completar dos veces devuelve 200 con `spaceSync: "SIN_CAMBIOS"` (idempotente).

Cada cambio se guarda en `outbox_events` dentro de la misma transacción y se envía a `PUT /api/v1/spaces/internal/reservations/:id`. Si spaces-service no responde, el evento queda PENDIENTE y se reintenta cada `OUTBOX_INTERVAL_MS` hasta `OUTBOX_MAX_ATTEMPTS` veces; luego queda FALLIDO y se registra en el log.

## Sensores (sensors-service :3004)

Objeto evento (historial):
```json
{
  "id": "uuid", "eventId": "uuid-del-sensor", "sensorId": "SIM-SENSOR-A01", "eventType": "VEHICLE_ENTERED",
  "spaceId": "uuid", "spaceCode": "A-01", "vehicleId": "uuid", "plate": "ABC123", "source": "MANUAL",
  "occurredAt": "…", "processedAt": "…", "status": "PROCESADO", "resultCode": "PROCESADO", "httpStatus": 201,
  "message": "Entrada de ABC123 registrada en A-01", "createdAt": "…"
}
```

`status` (resultado del procesamiento):
| Estado | Significado | HTTP |
|---|---|---|
| PROCESADO | El espacio se ocupó/liberó | 201 |
| RECHAZADO | Un servicio dueño lo rechazó por una regla (espacio ocupado, vehículo inexistente…). `resultCode` guarda el código. | 404 / 409 |
| FALLIDO | Una dependencia no respondió. **Se puede reintentar con el mismo `eventId`.** | 503 |
| PENDIENTE | En proceso | — |

| Método y ruta | Uso |
|---|---|
| `POST /api/v1/sensors/events/entry` | Simular entrada `{ eventId, sensorId, spaceId, vehicleId, timestamp?, source? }` |
| `POST /api/v1/sensors/events/exit` | Simular salida `{ eventId, sensorId, spaceId, timestamp?, source? }` |
| `GET /api/v1/sensors/events` | Historial, más reciente primero. Query: `type`, `status`, `spaceId`, `limit` (1–200, def. 50) |
| `GET /api/v1/sensors/health` | Estado del simulador (igual que `/health`) |

- `eventId` es obligatorio y lo genera quien envía el evento (el frontend usa `crypto.randomUUID()`). `source`: `MANUAL` (def.) o `AUTO` (modo automático).
- Respuesta 201: `{ duplicate: false, event, space }` (`space` es el estado actualizado del espacio).
- En un rechazo o fallo, el error trae el evento guardado en `error.details.event`.

Flujo de una entrada:
1. Se registra el evento (PENDIENTE). Si el `eventId` ya existe → ver idempotencia.
2. Se consulta a vehicles-service y a spaces-service (en paralelo): vehículo inexistente → 404 `VEHICLE_NOT_FOUND` ("regístrelo primero"); inactivo → 409 `VEHICLE_INACTIVE`; espacio inexistente → 404 `SPACE_NOT_FOUND`.
3. `POST /spaces/:id/occupy` con el mismo `eventId`. spaces-service decide (ocupado, reservado para otro, fuera de servicio → 409).
4. Si el vehículo es el titular de una reserva, se avisa a reservations-service (`internal/:id/start`); en la salida, `complete`. Si ese aviso falla, el evento se procesa igual (el espacio ya es correcto) y el mensaje lo indica.
5. Se guarda el resultado con la placa y el código del espacio para el historial.

**Idempotencia (§10.3):**
- Mismo `eventId` ya PROCESADO → **200**, `data.duplicate: true`, mensaje con `DUPLICATE_EVENT`, sin repetir la ocupación/liberación.
- Mismo `eventId` ya RECHAZADO → se repite el mismo rechazo (`error.details.duplicate: true`), sin volver a llamar a spaces.
- Mismo `eventId` FALLIDO → se vuelve a procesar.
- Mismo `eventId` en proceso, o usado para otro tipo de evento/espacio → 409 `DUPLICATE_EVENT`.

Las llamadas a otros servicios tienen timeout (`SERVICE_TIMEOUT_MS`) y 2 reintentos; son seguras de repetir porque ocupar/liberar son idempotentes por `eventId`.

## Pendientes

El modo automático del simulador (§10.4) está en el frontend: usa estos mismos endpoints con `source: "AUTO"`. El evento opcional `SENSOR_ERROR` no está implementado.
