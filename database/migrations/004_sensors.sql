-- Base: SENSORS_DB (smartpark_sensors). Dueño exclusivo: sensors-service.
CREATE TABLE IF NOT EXISTS sensor_events (
  id                CHAR(36)    NOT NULL PRIMARY KEY,
  event_id          VARCHAR(64) NOT NULL,
  sensor_id         VARCHAR(40) NOT NULL,
  space_id          CHAR(36)    NOT NULL,
  space_code        VARCHAR(10) NULL,  -- copia para el historial; la fuente de verdad es spaces-service
  vehicle_id        CHAR(36)    NULL,
  plate             VARCHAR(10) NULL,  -- copia para el historial
  event_type        ENUM('VEHICLE_ENTERED','VEHICLE_EXITED','SENSOR_ERROR') NOT NULL,
  source            VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  occurred_at       DATETIME(3) NOT NULL,
  processed_at      DATETIME(3) NULL,
  processing_status ENUM('PENDIENTE','PROCESADO','RECHAZADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
  result_code       VARCHAR(40) NULL,
  http_status       SMALLINT    NULL,
  message           VARCHAR(255) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sensor_event_id (event_id),
  KEY ix_sensor_events_created (created_at),
  KEY ix_sensor_events_type_status (event_type, processing_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
