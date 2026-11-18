-- Base: SPACES_DB (smartpark_spaces). Dueño exclusivo: spaces-service.

-- status guarda solo el estado operativo; RESERVADO se calcula a partir de space_reservations
CREATE TABLE IF NOT EXISTS parking_spaces (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  code        VARCHAR(10) NOT NULL,
  zone        VARCHAR(20) NOT NULL,
  space_type  ENUM('ESTANDAR','ACCESIBLE','MOTO') NOT NULL,
  status      ENUM('DISPONIBLE','OCUPADO','FUERA_DE_SERVICIO') NOT NULL DEFAULT 'DISPONIBLE',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_spaces_code (code),
  KEY ix_spaces_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS occupancies (
  id              CHAR(36)    NOT NULL PRIMARY KEY,
  space_id        CHAR(36)    NOT NULL,
  vehicle_id      CHAR(36)    NOT NULL,  -- referencia lógica a vehicles-service (sin FK entre bases)
  reservation_id  CHAR(36)    NULL,      -- reserva usada al entrar, si el espacio estaba reservado para este vehículo
  entry_at        DATETIME(3) NOT NULL,
  exit_at         DATETIME(3) NULL,
  source_event_id VARCHAR(64) NOT NULL,
  exit_event_id   VARCHAR(64) NULL,
  status          ENUM('ABIERTA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  -- Solo vale space_id mientras la ocupación está abierta: el índice único impide dos abiertas en el mismo espacio
  open_space_id   CHAR(36) GENERATED ALWAYS AS (IF(status = 'ABIERTA', space_id, NULL)) STORED,
  -- Igual para el vehículo: no puede estar estacionado en dos espacios a la vez
  open_vehicle_id CHAR(36) GENERATED ALWAYS AS (IF(status = 'ABIERTA', vehicle_id, NULL)) STORED,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_occ_open_space (open_space_id),
  UNIQUE KEY uq_occ_open_vehicle (open_vehicle_id),
  UNIQUE KEY uq_occ_source_event (source_event_id),
  UNIQUE KEY uq_occ_exit_event (exit_event_id),
  KEY ix_occ_space_status (space_id, status),
  CONSTRAINT fk_occ_space FOREIGN KEY (space_id) REFERENCES parking_spaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Copia local de las reservas, alimentada por eventos HTTP de reservations-service
CREATE TABLE IF NOT EXISTS space_reservations (
  reservation_id CHAR(36)    NOT NULL PRIMARY KEY,
  space_id       CHAR(36)    NOT NULL,
  vehicle_id     CHAR(36)    NOT NULL,
  start_at       DATETIME(3) NOT NULL,
  end_at         DATETIME(3) NOT NULL,
  status         ENUM('CONFIRMADA','EN_CURSO','COMPLETADA','CANCELADA','EXPIRADA') NOT NULL,
  -- updatedAt de la reserva en reservations-service: descarta eventos que llegan desordenados
  source_updated_at DATETIME(3) NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_sres_space (space_id, status, start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
