# Arquitectura de SmartPark

## Componentes

```
Navegador ──HTTP──▶ Gateway :3000 ──┬──▶ vehicles-service :3001 ──▶ smartpark_vehicles
   (frontend servido                ├──▶ spaces-service   :3002 ──▶ smartpark_spaces
    por el gateway)                 ├──▶ reservations     :3003 ──▶ smartpark_reservations
                                    └──▶ sensors-service  :3004 ──▶ smartpark_sensors

sensors-service ──HTTP (ocupar/liberar)──▶ spaces-service
reservations-service ──HTTP (eventos de reserva, reintentos)──▶ spaces-service
reservations-service ──HTTP (validar vehículo/espacio)──▶ vehicles / spaces
```

- Cada servicio es un proceso con su propio `package.json`, puerto, configuración y `GET /health`.
- Ningún servicio lee tablas de otro: los identificadores compartidos (`vehicle_id`, `space_id`) son referencias lógicas y se validan por HTTP.
- El gateway no tiene reglas de negocio ni acceso a base de datos: reenvía `/api/v1/<recurso>/...` al servicio dueño y agrega `X-Request-ID`.
- `shared/` es una librería sin dependencias (formato de respuesta, errores, `requestId`, logs JSON, cliente HTTP con timeout, pool MySQL). Cada componente la instala como `file:` en su `package.json`; no comparte estado en tiempo de ejecución.

## Decisiones técnicas

| # | Decisión | Motivo |
|---|---|---|
| D1 | Express 5, `mysql2`, `zod`; pruebas con `node:test` (incluido en Node) | Pocas dependencias; Express 5 propaga errores de handlers `async` al manejador central. |
| D2 | El frontend lo sirve el gateway (mismo origen) | Evita CORS y un servidor extra. CORS sigue limitado a `FRONTEND_ORIGIN` por si se usa otro servidor estático. |
| D3 | `parking_spaces.status` guarda solo DISPONIBLE / OCUPADO / FUERA_DE_SERVICIO; **RESERVADO se calcula** | spaces-service mantiene una copia (`space_reservations`) de las reservas que le envía reservations-service. Un espacio se muestra RESERVADO si tiene una reserva CONFIRMADA vigente o que empieza en los próximos `RESERVATION_HOLD_MINUTES` (60 por defecto). Así una reserva lejana no bloquea el espacio indefinidamente (§7.2). |
| D4 | Prioridad de estado visible: FUERA_DE_SERVICIO > OCUPADO > RESERVADO > DISPONIBLE | Regla única y fácil de probar. |
| D5 | Entrada en un espacio RESERVADO solo para el vehículo de esa reserva (la reserva pasa a EN_CURSO; al salir, COMPLETADA) | §5.1 prohíbe la entrada "por otra reserva vigente"; la del titular sí tiene sentido. |
| D6 | Concurrencia en ocupación: `UPDATE ... WHERE status='DISPONIBLE'` condicional + columna generada `open_space_id` con índice UNIQUE en `occupancies` | Dos ocupaciones simultáneas: solo una actualiza la fila; la base de datos además impide dos ocupaciones abiertas en el mismo espacio. |
| D7 | Idempotencia de sensores: `sensor_events.event_id` UNIQUE; un duplicado devuelve 200 con `DUPLICATE_EVENT` y el resultado guardado. spaces-service además guarda `source_event_id` / `exit_event_id` únicos. | Doble protección si el sensor reintenta después de un timeout. |
| D8 | Eventos asíncronos reservas → espacios con tabla `outbox_events` y reintentos limitados | Mecanismo HTTP simple permitido por §6.4, sin RabbitMQ. |
| D9 | Fechas en UTC en backend (sesión MySQL `+00:00`, `DATETIME(3)`), hora local en el navegador | §5.1. |
| D10 | Sin inicio de sesión | La autenticación está fuera del alcance (§3.2). |
| D11 | Una sola cuenta MySQL (`DB_USER`) con permisos sobre las 4 bases | Sencillez del prototipo. La propiedad de los datos se respeta en el código; para aislarla en la BD bastaría un usuario por servicio. |
| D12 | Placa única globalmente (no solo entre activos) | §8.4 pide `UNIQUE` en `plate`; un vehículo inactivo se reactiva en lugar de registrarse de nuevo. |
| D13 | El gateway no reintenta | Reintentar un POST podría duplicar efectos; los reintentos están en los servicios, que conocen la idempotencia de cada operación. |
| D14 | Un vehículo solo puede tener una ocupación abierta (`open_vehicle_id` UNIQUE) | No está explícito en la especificación, pero un mismo vehículo en dos espacios es una inconsistencia evidente. |
| D15 | spaces-service no consulta a vehicles-service en `occupy` | Quien origina la entrada (sensors-service, fase 5) valida que el vehículo exista y esté ACTIVO; spaces-service solo garantiza el estado del espacio. |
| D16 | spaces-service marca su copia de la reserva como EN_CURSO al entrar el titular y COMPLETADA al salir | Evita que el espacio vuelva a mostrarse RESERVADO tras usarse. La reserva original la actualiza reservations-service (fase 5); su evento, más nuevo, reemplaza la copia. |
| D17 | Control de concurrencia en ocupar/liberar: `SELECT … FOR UPDATE` del espacio + UPDATE condicional + índices únicos; las comprobaciones posteriores al bloqueo usan lecturas bloqueantes | Con REPEATABLE READ, una lectura normal dentro de la transacción puede ver una foto anterior al commit de otra; las lecturas `FOR UPDATE` ven el último dato confirmado. |
| D18 | Las rutas `/internal/` solo son accesibles entre servicios; el gateway responde 404 | Reducir la superficie pública sin añadir autenticación entre servicios. |
| D19 | El tipo de espacio no se cruza con el tipo de vehículo (una moto puede entrar en un espacio ESTANDAR) | La especificación no lo exige; se puede añadir como regla en sensors/reservations. |
| D20 | Solapamiento de reservas: bloqueo con nombre `GET_LOCK('smartpark_res_space_<id>')` + transacción | Serializa las reservas del mismo espacio sin bloqueos de rango de InnoDB, que con inserciones concurrentes provocan deadlocks. La comprobación de conflictos ocurre dentro del bloqueo. |
| D21 | Un vehículo tampoco puede tener dos reservas activas solapadas | Regla natural; se valida en la misma consulta. Limitación: el bloqueo es por espacio, así que dos reservas simultáneas del mismo vehículo en espacios distintos podrían confirmarse ambas. |
| D22 | Patrón outbox para avisar a spaces-service: el evento se guarda en la misma transacción que el cambio, se intenta enviar al momento y se reintenta periódicamente con un máximo de intentos | Si spaces-service está caído, la reserva no se pierde ni queda a medias; el aviso llega cuando vuelve. Un 4xx se marca FALLIDO de inmediato (no se arreglará reintentando). |
| D23 | `updated_at` de una reserva avanza al menos 1 ms en cada cambio | spaces-service ordena los eventos por ese valor; dos cambios en el mismo milisegundo se confundirían con un duplicado. |
| D24 | La reserva guarda copia de `plate` y `space_code` | Permite listar y filtrar por placa sin llamar a vehicles-service en cada consulta. Si la placa se edita después, la reserva conserva la placa original. |
| D25 | Cancelar/completar una reserva que ya está en ese estado devuelve 200 sin efecto | Idempotencia para reintentos del cliente. |
| D27 | sensors-service orquesta la entrada/salida (valida vehículo y espacio, pide ocupar/liberar, avisa a reservas) pero no decide el estado del espacio | El flujo §5.2 lo describe así; spaces-service sigue siendo la fuente de verdad. |
| D28 | Tres resultados por evento: PROCESADO, RECHAZADO (regla de negocio, definitivo) y FALLIDO (dependencia caída, reintentable con el mismo `eventId`) | Distinguir "no se puede" de "ahora no se pudo" es lo que hace útil la idempotencia ante fallos parciales. |
| D29 | Repetir un evento ya resuelto devuelve el resultado guardado (200 si se procesó, el mismo error si se rechazó) | §10.3: "devolver el resultado previamente almacenado". |
| D30 | Los avisos a reservations-service tras entrar/salir el titular son de mejor esfuerzo (2 reintentos); si fallan, el evento queda PROCESADO con una nota | El estado del espacio ya es correcto (spaces-service actualizó su copia de la reserva); bloquear la entrada por eso sería peor. Limitación: la reserva puede quedar CONFIRMADA en reservations-service hasta revisarla. |
| D31 | El historial guarda copia de placa y código de espacio | §10.4 pide mostrar espacio y placa en la tabla de eventos sin consultar otros servicios por cada fila. |
| D26 | Las validaciones remotas (vehículo, elegibilidad del espacio) se hacen antes del bloqueo | No retener el bloqueo durante llamadas HTTP. El estado del espacio puede cambiar después, pero la regla crítica (no solapar reservas) se valida dentro del bloqueo. |

## Modelo de datos (resumen)

- **smartpark_vehicles.vehicles**: `id`, `plate` (UNIQUE), `vehicle_type`, `brand`, `color`, `status`.
- **smartpark_spaces.parking_spaces**: `id`, `code` (UNIQUE), `zone`, `space_type`, `status`.
- **smartpark_spaces.occupancies**: `space_id` (FK local), `vehicle_id`, `entry_at`, `exit_at`, `source_event_id`, `exit_event_id`, `status`, `open_space_id` (generada, UNIQUE).
- **smartpark_spaces.space_reservations**: copia de las reservas para calcular RESERVADO.
- **smartpark_reservations.reservations**: `reservation_code` (UNIQUE), `vehicle_id`, `space_id`, `start_at`, `end_at`, `status`, `cancelled_at`.
- **smartpark_reservations.outbox_events**: eventos pendientes de entregar a spaces-service.
- **smartpark_sensors.sensor_events**: `event_id` (UNIQUE), `sensor_id`, `space_id`, `vehicle_id`, copia de `space_code` y `plate` para el historial, `event_type`, `processing_status`, `result_code`, `message`.

Scripts: `database/migrations/NNN_<servicio>.sql` y `database/seeds/NNN_<servicio>.sql`. El sufijo indica la base donde se aplican. `database/setup.js` los aplica en orden.

## Limitaciones conocidas

- El estado EXPIRADA de las reservas existe en el esquema pero no se asigna automáticamente. Una reserva CONFIRMADA cuyo `endAt` ya pasó no bloquea nada (todas las consultas filtran por `end_at > ahora`), solo sigue apareciendo como CONFIRMADA en el listado.
- Un evento del outbox que queda FALLIDO no se reintenta solo; hay que revisarlo en `outbox_events` (el log registra cada fallo).
- No hay transacciones distribuidas: si un paso entre servicios falla, se registra y se devuelve un error controlado (§6.5).
