-- Base: VEHICLES_DB (smartpark_vehicles). Dueño exclusivo: vehicles-service.
CREATE TABLE IF NOT EXISTS vehicles (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  plate        VARCHAR(10)  NOT NULL,
  vehicle_type ENUM('CARRO','MOTO','BICICLETA') NOT NULL,
  brand        VARCHAR(60)  NULL,
  color        VARCHAR(30)  NULL,
  status       ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_vehicles_plate (plate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
