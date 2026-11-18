# Frontend de SmartPark

Panel administrativo en HTML, CSS y JavaScript (módulos ES nativos, sin framework ni paso de compilación). Lo sirve el gateway en http://localhost:3000 y solo consume la API del gateway (`/api/v1`).

## Estructura

```
index.html              estructura: navegación, contenedor principal, avisos y diálogo
assets/css/app.css      estilos y tokens de diseño (colores de estado, tipografía, responsive)
assets/img/logo.svg
assets/js/app.js        enrutador por hash (#dashboard, #espacios…) e indicador de conexión
assets/js/api.js        cliente del gateway; los errores llegan como ApiError { status, code, message, details }
assets/js/ui.js         plantillas con escape de HTML, insignias de estado, fechas locales, diálogos y avisos
assets/js/lot.js        plano del parqueadero (tablero y vista "Plano" de espacios)
assets/js/views/        una vista por sección
```

## Secciones

| Sección | Qué permite |
|---|---|
| Tablero | Indicadores, plano de espacios por zona, actividad reciente. Se refresca cada 5 s. |
| Espacios | Tabla o plano con filtros por estado, tipo y zona; crear, editar, poner fuera de servicio o habilitar. |
| Vehículos | Búsqueda por placa, registro, edición, activar y desactivar. |
| Reservas | Filtros por estado, fecha (día local) y placa; crear, ver detalle, completar y cancelar. |
| Simulador | Entrada y salida manuales, reenvío del último evento (demuestra la idempotencia), modo automático con intervalo y botón Detener, bitácora. |
| Estado del sistema | Estado del gateway, de cada servicio y de su base de datos. Se refresca cada 10 s. |

## Decisiones

- Las fechas viajan en UTC y se muestran en la hora local del navegador (`Intl.DateTimeFormat('es-CO')`). Los campos `datetime-local` se convierten a ISO UTC antes de enviarse.
- El estado nunca depende solo del color: cada insignia lleva texto e icono.
- Las acciones que no corresponden al estado se deshabilitan (por ejemplo "Simular salida" en un espacio libre) y las acciones destructivas piden confirmación.
- Todo texto que viene del servidor se escapa al insertarse en el HTML (`html```, `esc()`).
- La tipografía Barlow se carga de Google Fonts; sin internet se usa la fuente del sistema.
