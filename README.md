# SmartPark

Sistema distribuido de gestión inteligente de parqueaderos (prototipo académico).
Cinco procesos Node.js independientes que se comunican por HTTP/JSON, cada servicio dueño de su propia base MySQL.

| Componente | Puerto | Base de datos | Responsabilidad |
|---|---|---|---|
| gateway (+ frontend) | 3000 | — | Punto de entrada, enrutamiento, health agregado, sirve la interfaz |
| vehicles-service | 3001 | `smartpark_vehicles` | Registro maestro de vehículos |
| spaces-service | 3002 | `smartpark_spaces` | Espacios, ocupaciones, disponibilidad (fuente de verdad) |
| reservations-service | 3003 | `smartpark_reservations` | Ciclo de vida de reservas |
| sensors-service | 3004 | `smartpark_sensors` | Sensores simulados, idempotencia, historial de eventos |
| MySQL 8.4 | 3306 | — | Una instancia, cuatro bases separadas |

## Estado de la implementación

| Fase | Estado |
|---|---|
| 1. Base del proyecto (estructura, MySQL, health checks) | ✅ verificada con MySQL 8.0 local |
| 2. Vehículos (CRUD, normalización de placa, unicidad, activar/desactivar) | ✅ verificada con MySQL |
| 3. Espacios (CRUD, estados, ocupar/liberar idempotente, mantenimiento, resumen, concurrencia) | ✅ verificada con MySQL, incluida la prueba de concurrencia §14.4 |
| 4. Reservas (crear, listar, cancelar, completar, solapamientos, aviso a espacios con reintentos) | ✅ verificada con MySQL y flujo completo por el gateway |
| 5. Sensores | pendiente |
| 6. Gateway y frontend | pendiente (el gateway ya enruta; hay una página mínima de estado) |
| 7. Integración | pendiente |
| 8. Pruebas y entrega | pendiente |

## Requisitos previos

- **Docker Desktop** (opción recomendada), o
- **Node.js 22.9+** y **MySQL 8** instalados localmente.

## Opción A: todo con Docker Compose (recomendada)

```bash
cp .env.example .env        # opcional: sin .env se usan los valores por defecto
docker compose up --build
```

Compose levanta MySQL, ejecuta una vez `db-setup` (crea las bases, el usuario, las tablas y los datos de demostración) y luego arranca los 4 servicios y el gateway.

- Interfaz: http://localhost:3000
- Estado del sistema: http://localhost:3000/health

Para borrar los datos y empezar de cero: `docker compose down -v`.

## Opción B: servicios con Node y MySQL en Docker (para desarrollar)

```bash
cp .env.example .env
npm run setup                      # npm install en cada componente
docker compose up -d mysql         # solo MySQL (o usa un MySQL 8 local, ver abajo)
npm run db:setup                   # bases, usuario, tablas y seed
npm run dev                        # los 5 procesos con recarga automática
```

Con un **MySQL local** en lugar de Docker (por ejemplo el servicio `MySQL80` de Windows): omite `docker compose up -d mysql`, pon en `.env` la contraseña de root en `DB_ROOT_PASSWORD` y ejecuta `npm run db:setup`. El script crea el usuario `DB_USER` con `DB_PASSWORD`. Root solo se usa en ese paso; también puedes no guardarlo en `.env` y pasarlo solo en la terminal:

```powershell
$env:DB_ROOT_PASSWORD='tu_contraseña'; npm run db:setup
```

Cada componente también arranca por separado, por ejemplo: `cd services/vehicles-service && npm start`.

## Pruebas

```bash
npm test
```

- Sin MySQL corren las pruebas unitarias (validación y normalización de placas), las de la API con un repositorio en memoria, las del gateway (reenvío, `X-Request-ID`, 503 controlado) y las de health check.
- Con MySQL disponible (después de `npm run db:setup`), la misma suite de API se ejecuta además contra la base real (`test/*.mysql.test.js`). Si la base no responde, esa prueba aparece como omitida (`skipped`), no como aprobada. Las placas de prueba empiezan por `ZZ` y se borran al terminar.

## Datos de demostración

- 20 espacios: `A-01`…`A-10` (A-01 y A-02 accesibles), `B-01`…`B-06`, `M-01`…`M-04` (motos).
- 6 vehículos: `ABC123`, `DEF456`, `GHI789`, `MNO345` (carros), `JKL12D`, `PQR34E` (motos).

El seed es idempotente: `npm run db:setup` puede ejecutarse varias veces sin duplicar datos.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| `/health` muestra `database: DOWN` | MySQL no está arrancado o las credenciales de `.env` no coinciden. Ejecuta `npm run db:setup`. |
| `db-setup` falla con `Access denied` | El volumen de MySQL se creó con otra contraseña de root. `docker compose down -v` y vuelve a levantar. |
| `port is already allocated` en 3306 | Ya tienes un MySQL local. Define `MYSQL_HOST_PORT=3307` en `.env` (y `DB_PORT=3307` si usas la opción B). |
| Un servicio aparece `DOWN` | El proceso no está corriendo; el gateway responde 503 `DEPENDENCY_UNAVAILABLE` en sus rutas. |

## Documentación

- [docs/arquitectura.md](docs/arquitectura.md): componentes, decisiones técnicas y limitaciones.
- [docs/api.md](docs/api.md): formato de respuesta, códigos de error y endpoints.
- [docs/especificacion.txt](docs/especificacion.txt): especificación funcional y técnica original (texto).
