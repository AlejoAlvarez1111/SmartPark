-- Base: RESERVATIONS_DB (smartpark_reservations). Dueño exclusivo: reservations-service.
CREATE TABLE IF NOT EXISTS reservations (
  id               CHAR(36)    NOT NULL PRIMARY KEY,
  reservation_code VARCHAR(12) NOT NULL,
  vehicle_id       CHAR(36)    NOT NULL,  -- referencia lógica a vehicles-service
  space_id         CHAR(36)    NOT NULL,  -- referencia lógica a spaces-service
  plate            VARCHAR(10) NOT NULL,  -- copia al crear, para listar y filtrar sin consultar a vehicles-service
  space_code       VARCHAR(10) NOT NULL,  -- copia al crear, idem con spaces-service
  start_at         DATETIME(3) NOT NULL,
  end_at           DATETIME(3) NOT NULL,
  status           ENUM('CONFIRMADA','EN_CURSO','COMPLETADA','CANCELADA','EXPIRADA') NOT NULL DEFAULT 'CONFIRMADA',
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  cancelled_at     DATETIME(3) NULL,
  UNIQUE KEY uq_res_code (reservation_code),
  KEY ix_res_space (space_id, status, start_at, end_at),
  KEY ix_res_vehicle (vehicle_id, status, start_at, end_at),
  KEY ix_res_plate (plate),
  KEY ix_res_start (start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Eventos de dominio pendientes de entregar a spaces-service (reintentos limitados, §6.4)
CREATE TABLE IF NOT EXISTS outbox_events (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type   VARCHAR(40) NOT NULL,
  payload      JSON        NOT NULL,
  status       ENUM('PENDIENTE','ENTREGADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
  attempts     INT         NOT NULL DEFAULT 0,
  last_error   VARCHAR(255) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_outbox_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
