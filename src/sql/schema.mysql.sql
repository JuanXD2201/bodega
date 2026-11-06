-- ============================================================================
-- Bodega · esquema para MySQL 8.0.16 o superior (InnoDB, utf8mb4)
-- Traducción escrita a mano del esquema SQLite de la aplicación.
--
-- Diferencias frente a SQLite (resumen; el detalle está en docs/MODELO_DE_DATOS.md):
--   * AUTO_INCREMENT en lugar de AUTOINCREMENT; VARCHAR/DATETIME/TINYINT con tamaño explícito.
--   * Las restricciones CHECK solo se aplican desde MySQL 8.0.16.
--   * MySQL no tiene «UPDATE OF columna»: los triggers comparan OLD y NEW.
--   * Los errores se lanzan con SIGNAL SQLSTATE '45000' en vez de RAISE(ABORT, ...).
--   * Los triggers se crean DESPUÉS de cargar los datos de ejemplo para no duplicar movimientos.
--
-- Uso:  mysql -u root -p < schema.mysql.sql
-- ============================================================================

CREATE DATABASE IF NOT EXISTS bodega CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE bodega;
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP VIEW IF EXISTS v_movimientos_detalle, v_rotacion, v_ventas_cliente, v_ventas_producto, v_ordenes_totales,
                    v_pedidos_totales, v_valor_inventario, v_stock_bajo, v_stock_producto;
DROP TABLE IF EXISTS movimientos, ajustes, traslados, recepciones, compra_lineas, ordenes_compra, pedido_lineas,
                     pedidos, clientes, existencias, productos, bodegas, proveedores, categorias, usuarios, roles;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================== TABLAS ==============================

CREATE TABLE roles (
  id          INT NOT NULL PRIMARY KEY,
  nombre      VARCHAR(20) NOT NULL UNIQUE,
  descripcion VARCHAR(200) NOT NULL,
  CONSTRAINT ck_roles_nombre CHECK (nombre IN ('administrador', 'vendedor', 'bodeguero'))
) ENGINE = InnoDB;

CREATE TABLE usuarios (
  id     INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  email  VARCHAR(120) NOT NULL UNIQUE,
  rol_id INT NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT ck_usuarios_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
  CONSTRAINT ck_usuarios_activo CHECK (activo IN (0, 1)),
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles (id)
) ENGINE = InnoDB;

CREATE TABLE categorias (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL UNIQUE,
  descripcion VARCHAR(200) NOT NULL DEFAULT '',
  CONSTRAINT ck_categorias_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) > 0)
) ENGINE = InnoDB;

CREATE TABLE proveedores (
  id       INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre   VARCHAR(120) NOT NULL,
  nit      VARCHAR(30) NOT NULL UNIQUE,
  contacto VARCHAR(80) NOT NULL DEFAULT '',
  email    VARCHAR(120) NOT NULL DEFAULT '',
  telefono VARCHAR(20) NOT NULL DEFAULT '',
  ciudad   VARCHAR(60) NOT NULL DEFAULT '',
  activo   TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT ck_proveedores_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
  CONSTRAINT ck_proveedores_activo CHECK (activo IN (0, 1))
) ENGINE = InnoDB;

CREATE TABLE bodegas (
  id     INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(10) NOT NULL UNIQUE,
  nombre VARCHAR(80) NOT NULL,
  ciudad VARCHAR(60) NOT NULL DEFAULT '',
  activa TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT ck_bodegas_codigo CHECK (CHAR_LENGTH(codigo) BETWEEN 2 AND 10),
  CONSTRAINT ck_bodegas_activa CHECK (activa IN (0, 1))
) ENGINE = InnoDB;

CREATE TABLE productos (
  id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sku          VARCHAR(20) NOT NULL,
  nombre       VARCHAR(120) NOT NULL,
  descripcion  VARCHAR(400) NOT NULL DEFAULT '',
  categoria_id INT NOT NULL,
  proveedor_id INT NULL,
  unidad       VARCHAR(12) NOT NULL DEFAULT 'und',
  costo        INT NOT NULL,
  precio       INT NOT NULL,
  stock_minimo INT NOT NULL DEFAULT 0,
  activo       TINYINT(1) NOT NULL DEFAULT 1,
  creado_en    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_productos_sku UNIQUE (sku),
  CONSTRAINT ck_productos_sku CHECK (CHAR_LENGTH(sku) BETWEEN 3 AND 20 AND sku REGEXP '^[A-Z0-9-]+$'),
  CONSTRAINT ck_productos_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
  CONSTRAINT ck_productos_costo CHECK (costo >= 0),
  CONSTRAINT ck_productos_precio CHECK (precio > 0),
  CONSTRAINT ck_productos_minimo CHECK (stock_minimo >= 0),
  CONSTRAINT ck_productos_activo CHECK (activo IN (0, 1)),
  CONSTRAINT fk_productos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias (id),
  CONSTRAINT fk_productos_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores (id),
  INDEX idx_productos_categoria (categoria_id),
  INDEX idx_productos_proveedor (proveedor_id)
) ENGINE = InnoDB;

CREATE TABLE existencias (
  producto_id INT NOT NULL,
  bodega_id   INT NOT NULL,
  cantidad    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, bodega_id),
  CONSTRAINT ck_existencias_cantidad CHECK (cantidad >= 0),
  CONSTRAINT fk_existencias_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_existencias_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  INDEX idx_existencias_bodega (bodega_id)
) ENGINE = InnoDB;

CREATE TABLE clientes (
  id        INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre    VARCHAR(120) NOT NULL,
  documento VARCHAR(30) NOT NULL UNIQUE,
  email     VARCHAR(120) NOT NULL DEFAULT '',
  telefono  VARCHAR(20) NOT NULL DEFAULT '',
  ciudad    VARCHAR(60) NOT NULL DEFAULT '',
  activo    TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT ck_clientes_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) > 0),
  CONSTRAINT ck_clientes_activo CHECK (activo IN (0, 1))
) ENGINE = InnoDB;

CREATE TABLE pedidos (
  id                 INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  numero             VARCHAR(20) NOT NULL UNIQUE,
  cliente_id         INT NOT NULL,
  usuario_id         INT NOT NULL,
  bodega_id          INT NOT NULL,
  estado             VARCHAR(12) NOT NULL DEFAULT 'borrador',
  fecha              DATETIME NOT NULL,
  fecha_confirmacion DATETIME NULL,
  fecha_despacho     DATETIME NULL,
  fecha_anulacion    DATETIME NULL,
  notas              VARCHAR(300) NOT NULL DEFAULT '',
  CONSTRAINT ck_pedidos_estado CHECK (estado IN ('borrador', 'confirmado', 'despachado', 'anulado')),
  CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_pedidos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_pedidos_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  INDEX idx_pedidos_cliente (cliente_id),
  INDEX idx_pedidos_estado_fecha (estado, fecha)
) ENGINE = InnoDB;

CREATE TABLE pedido_lineas (
  id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pedido_id       INT NOT NULL,
  producto_id     INT NOT NULL,
  cantidad        INT NOT NULL,
  precio_unitario INT NOT NULL,
  CONSTRAINT uq_pedido_producto UNIQUE (pedido_id, producto_id),
  CONSTRAINT ck_pl_cantidad CHECK (cantidad > 0),
  CONSTRAINT ck_pl_precio CHECK (precio_unitario >= 0),
  CONSTRAINT fk_pl_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
  CONSTRAINT fk_pl_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  INDEX idx_pedido_lineas_producto (producto_id)
) ENGINE = InnoDB;

CREATE TABLE ordenes_compra (
  id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  numero       VARCHAR(20) NOT NULL UNIQUE,
  proveedor_id INT NOT NULL,
  bodega_id    INT NOT NULL,
  usuario_id   INT NOT NULL,
  estado       VARCHAR(12) NOT NULL DEFAULT 'borrador',
  fecha        DATETIME NOT NULL,
  notas        VARCHAR(300) NOT NULL DEFAULT '',
  CONSTRAINT ck_oc_estado CHECK (estado IN ('borrador', 'enviada', 'parcial', 'recibida', 'anulada')),
  CONSTRAINT fk_oc_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores (id),
  CONSTRAINT fk_oc_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_oc_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  INDEX idx_ordenes_proveedor (proveedor_id)
) ENGINE = InnoDB;

CREATE TABLE compra_lineas (
  id                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  orden_id          INT NOT NULL,
  producto_id       INT NOT NULL,
  cantidad_pedida   INT NOT NULL,
  cantidad_recibida INT NOT NULL DEFAULT 0,
  costo_unitario    INT NOT NULL,
  CONSTRAINT uq_cl_orden_producto UNIQUE (orden_id, producto_id),
  CONSTRAINT ck_cl_pedida CHECK (cantidad_pedida > 0),
  CONSTRAINT ck_cl_recibida CHECK (cantidad_recibida >= 0),
  CONSTRAINT ck_cl_costo CHECK (costo_unitario >= 0),
  CONSTRAINT ck_cl_recibida_max CHECK (cantidad_recibida <= cantidad_pedida),
  CONSTRAINT fk_cl_orden FOREIGN KEY (orden_id) REFERENCES ordenes_compra (id) ON DELETE CASCADE,
  CONSTRAINT fk_cl_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  INDEX idx_compra_lineas_producto (producto_id)
) ENGINE = InnoDB;

CREATE TABLE recepciones (
  id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  linea_id   INT NOT NULL,
  cantidad   INT NOT NULL,
  fecha      DATETIME NOT NULL,
  usuario_id INT NOT NULL,
  nota       VARCHAR(200) NOT NULL DEFAULT '',
  CONSTRAINT ck_rec_cantidad CHECK (cantidad > 0),
  CONSTRAINT fk_rec_linea FOREIGN KEY (linea_id) REFERENCES compra_lineas (id),
  CONSTRAINT fk_rec_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  INDEX idx_recepciones_linea (linea_id)
) ENGINE = InnoDB;

CREATE TABLE traslados (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  producto_id INT NOT NULL,
  origen_id   INT NOT NULL,
  destino_id  INT NOT NULL,
  cantidad    INT NOT NULL,
  fecha       DATETIME NOT NULL,
  usuario_id  INT NOT NULL,
  nota        VARCHAR(200) NOT NULL DEFAULT '',
  CONSTRAINT ck_tr_cantidad CHECK (cantidad > 0),
  CONSTRAINT ck_tr_bodegas CHECK (origen_id <> destino_id),
  CONSTRAINT fk_tr_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_tr_origen FOREIGN KEY (origen_id) REFERENCES bodegas (id),
  CONSTRAINT fk_tr_destino FOREIGN KEY (destino_id) REFERENCES bodegas (id),
  CONSTRAINT fk_tr_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE = InnoDB;

CREATE TABLE ajustes (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  producto_id INT NOT NULL,
  bodega_id   INT NOT NULL,
  cantidad    INT NOT NULL,
  motivo      VARCHAR(12) NOT NULL,
  fecha       DATETIME NOT NULL,
  usuario_id  INT NOT NULL,
  nota        VARCHAR(200) NOT NULL DEFAULT '',
  CONSTRAINT ck_aj_cantidad CHECK (cantidad <> 0),
  CONSTRAINT ck_aj_motivo CHECK (motivo IN ('conteo', 'merma', 'daño', 'corrección')),
  CONSTRAINT fk_aj_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_aj_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_aj_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE = InnoDB;

-- Libro de movimientos: única vía por la que cambian las existencias.
CREATE TABLE movimientos (
  id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fecha           DATETIME NOT NULL,
  tipo            VARCHAR(16) NOT NULL,
  producto_id     INT NOT NULL,
  bodega_id       INT NOT NULL,
  cantidad        INT NOT NULL,
  referencia_tipo VARCHAR(10) NOT NULL,
  referencia_id   INT NOT NULL,
  usuario_id      INT NOT NULL,
  nota            VARCHAR(200) NOT NULL DEFAULT '',
  CONSTRAINT ck_mov_tipo CHECK (tipo IN ('entrada', 'salida', 'ajuste', 'traslado_entrada', 'traslado_salida')),
  CONSTRAINT ck_mov_cantidad CHECK (cantidad <> 0),
  CONSTRAINT ck_mov_ref CHECK (referencia_tipo IN ('pedido', 'compra', 'traslado', 'ajuste')),
  CONSTRAINT ck_mov_signo CHECK (
    (tipo IN ('entrada', 'traslado_entrada') AND cantidad > 0) OR
    (tipo IN ('salida', 'traslado_salida') AND cantidad < 0) OR
    tipo = 'ajuste'),
  CONSTRAINT fk_mov_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_mov_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_mov_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  INDEX idx_movimientos_producto_fecha (producto_id, fecha),
  INDEX idx_movimientos_fecha (fecha),
  INDEX idx_movimientos_ref (referencia_tipo, referencia_id)
) ENGINE = InnoDB;

-- ========================== DATOS DE EJEMPLO ==========================
-- (generados desde la misma semilla determinista que usa la aplicación)

SET FOREIGN_KEY_CHECKS = 0;
-- @@DATOS@@
SET FOREIGN_KEY_CHECKS = 1;

-- ============================== TRIGGERS ==============================

DELIMITER $$

CREATE TRIGGER trg_productos_precio_ins BEFORE INSERT ON productos FOR EACH ROW
BEGIN
  IF NEW.precio < NEW.costo THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El precio de venta no puede ser menor al costo';
  END IF;
END$$

CREATE TRIGGER trg_productos_precio_upd BEFORE UPDATE ON productos FOR EACH ROW
BEGIN
  IF NEW.precio < NEW.costo THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El precio de venta no puede ser menor al costo';
  END IF;
END$$

CREATE TRIGGER trg_mov_inmutable_upd BEFORE UPDATE ON movimientos FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los movimientos de inventario no se pueden modificar';
END$$

CREATE TRIGGER trg_mov_inmutable_del BEFORE DELETE ON movimientos FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los movimientos de inventario no se pueden eliminar';
END$$

CREATE TRIGGER trg_mov_stock_suficiente BEFORE INSERT ON movimientos FOR EACH ROW
BEGIN
  IF NEW.cantidad < 0 AND
     COALESCE((SELECT cantidad FROM existencias
               WHERE producto_id = NEW.producto_id AND bodega_id = NEW.bodega_id), 0) + NEW.cantidad < 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stock insuficiente: la operación dejaría la existencia en negativo';
  END IF;
END$$

CREATE TRIGGER trg_mov_aplicar AFTER INSERT ON movimientos FOR EACH ROW
BEGIN
  INSERT IGNORE INTO existencias (producto_id, bodega_id, cantidad) VALUES (NEW.producto_id, NEW.bodega_id, 0);
  UPDATE existencias SET cantidad = cantidad + NEW.cantidad
   WHERE producto_id = NEW.producto_id AND bodega_id = NEW.bodega_id;
END$$

-- ---- Pedidos de venta ----

CREATE TRIGGER trg_pedidos_validar BEFORE UPDATE ON pedidos FOR EACH ROW
BEGIN
  IF OLD.estado <> NEW.estado THEN
    IF NOT ((OLD.estado = 'borrador' AND NEW.estado IN ('confirmado', 'anulado')) OR
            (OLD.estado = 'confirmado' AND NEW.estado IN ('despachado', 'anulado'))) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transición de estado de pedido no permitida';
    END IF;
    IF NEW.estado = 'confirmado' AND OLD.estado = 'borrador'
       AND NOT EXISTS (SELECT 1 FROM pedido_lineas WHERE pedido_id = NEW.id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se puede confirmar un pedido sin líneas';
    END IF;
  END IF;
END$$

CREATE TRIGGER trg_pedidos_borrar BEFORE DELETE ON pedidos FOR EACH ROW
BEGIN
  IF OLD.estado <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden eliminar pedidos en borrador';
  END IF;
END$$

CREATE TRIGGER trg_pedidos_efectos AFTER UPDATE ON pedidos FOR EACH ROW
BEGIN
  IF NEW.estado = 'confirmado' AND OLD.estado = 'borrador' THEN
    INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
    SELECT COALESCE(NEW.fecha_confirmacion, NOW()), 'salida', l.producto_id, NEW.bodega_id, -l.cantidad,
           'pedido', NEW.id, NEW.usuario_id, CONCAT('Pedido ', NEW.numero)
    FROM pedido_lineas l WHERE l.pedido_id = NEW.id ORDER BY l.id;
  ELSEIF NEW.estado = 'anulado' AND OLD.estado = 'confirmado' THEN
    INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
    SELECT COALESCE(NEW.fecha_anulacion, NOW()), 'entrada', l.producto_id, NEW.bodega_id, l.cantidad,
           'pedido', NEW.id, NEW.usuario_id, CONCAT('Anulación del pedido ', NEW.numero)
    FROM pedido_lineas l WHERE l.pedido_id = NEW.id ORDER BY l.id;
  END IF;
END$$

CREATE TRIGGER trg_lineas_pedido_ins BEFORE INSERT ON pedido_lineas FOR EACH ROW
BEGIN
  IF (SELECT estado FROM pedidos WHERE id = NEW.pedido_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden modificar líneas de pedidos en borrador';
  END IF;
END$$

CREATE TRIGGER trg_lineas_pedido_upd BEFORE UPDATE ON pedido_lineas FOR EACH ROW
BEGIN
  IF (SELECT estado FROM pedidos WHERE id = OLD.pedido_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden modificar líneas de pedidos en borrador';
  END IF;
END$$

CREATE TRIGGER trg_lineas_pedido_del BEFORE DELETE ON pedido_lineas FOR EACH ROW
BEGIN
  IF (SELECT estado FROM pedidos WHERE id = OLD.pedido_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden modificar líneas de pedidos en borrador';
  END IF;
END$$

-- ---- Órdenes de compra ----

CREATE TRIGGER trg_ordenes_validar BEFORE UPDATE ON ordenes_compra FOR EACH ROW
BEGIN
  IF OLD.estado <> NEW.estado THEN
    IF NOT ((OLD.estado = 'borrador' AND NEW.estado IN ('enviada', 'anulada')) OR
            (OLD.estado = 'enviada' AND NEW.estado IN ('parcial', 'recibida', 'anulada')) OR
            (OLD.estado = 'parcial' AND NEW.estado = 'recibida')) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transición de estado de orden de compra no permitida';
    END IF;
    IF NEW.estado = 'enviada' AND OLD.estado = 'borrador'
       AND NOT EXISTS (SELECT 1 FROM compra_lineas WHERE orden_id = NEW.id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se puede enviar una orden sin líneas';
    END IF;
  END IF;
END$$

CREATE TRIGGER trg_ordenes_borrar BEFORE DELETE ON ordenes_compra FOR EACH ROW
BEGIN
  IF OLD.estado <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden eliminar órdenes en borrador';
  END IF;
END$$

CREATE TRIGGER trg_compra_lineas_ins BEFORE INSERT ON compra_lineas FOR EACH ROW
BEGIN
  IF (SELECT estado FROM ordenes_compra WHERE id = NEW.orden_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden modificar líneas de órdenes en borrador';
  END IF;
END$$

CREATE TRIGGER trg_compra_lineas_upd BEFORE UPDATE ON compra_lineas FOR EACH ROW
BEGIN
  IF (NEW.producto_id <> OLD.producto_id OR NEW.cantidad_pedida <> OLD.cantidad_pedida OR NEW.costo_unitario <> OLD.costo_unitario)
     AND (SELECT estado FROM ordenes_compra WHERE id = OLD.orden_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden modificar líneas de órdenes en borrador';
  END IF;
END$$

CREATE TRIGGER trg_compra_lineas_del BEFORE DELETE ON compra_lineas FOR EACH ROW
BEGIN
  IF (SELECT estado FROM ordenes_compra WHERE id = OLD.orden_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden modificar líneas de órdenes en borrador';
  END IF;
END$$

-- ---- Recepciones ----

CREATE TRIGGER trg_recepciones_validar BEFORE INSERT ON recepciones FOR EACH ROW
BEGIN
  IF (SELECT o.estado FROM compra_lineas l JOIN ordenes_compra o ON o.id = l.orden_id
      WHERE l.id = NEW.linea_id) NOT IN ('enviada', 'parcial') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La orden de compra no admite recepciones en su estado actual';
  END IF;
  IF NEW.cantidad > (SELECT cantidad_pedida - cantidad_recibida FROM compra_lineas WHERE id = NEW.linea_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cantidad recibida supera lo pendiente de la línea';
  END IF;
END$$

CREATE TRIGGER trg_recepciones_aplicar AFTER INSERT ON recepciones FOR EACH ROW
BEGIN
  DECLARE v_orden INT;
  SELECT orden_id INTO v_orden FROM compra_lineas WHERE id = NEW.linea_id;

  UPDATE compra_lineas SET cantidad_recibida = cantidad_recibida + NEW.cantidad WHERE id = NEW.linea_id;

  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  SELECT NEW.fecha, 'entrada', l.producto_id, o.bodega_id, NEW.cantidad, 'compra', o.id, NEW.usuario_id,
         CONCAT('Recepción de la orden ', o.numero)
  FROM compra_lineas l JOIN ordenes_compra o ON o.id = l.orden_id WHERE l.id = NEW.linea_id;

  UPDATE ordenes_compra
     SET estado = CASE
       WHEN EXISTS (SELECT 1 FROM compra_lineas c WHERE c.orden_id = v_orden AND c.cantidad_recibida < c.cantidad_pedida)
       THEN 'parcial' ELSE 'recibida' END
   WHERE id = v_orden;
END$$

-- ---- Traslados y ajustes ----

CREATE TRIGGER trg_traslados_aplicar AFTER INSERT ON traslados FOR EACH ROW
BEGIN
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  VALUES (NEW.fecha, 'traslado_salida', NEW.producto_id, NEW.origen_id, -NEW.cantidad, 'traslado', NEW.id, NEW.usuario_id, NEW.nota);
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  VALUES (NEW.fecha, 'traslado_entrada', NEW.producto_id, NEW.destino_id, NEW.cantidad, 'traslado', NEW.id, NEW.usuario_id, NEW.nota);
END$$

CREATE TRIGGER trg_ajustes_aplicar AFTER INSERT ON ajustes FOR EACH ROW
BEGIN
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  VALUES (NEW.fecha, 'ajuste', NEW.producto_id, NEW.bodega_id, NEW.cantidad, 'ajuste', NEW.id, NEW.usuario_id,
          CONCAT(NEW.motivo, CASE WHEN NEW.nota = '' THEN '' ELSE CONCAT(': ', NEW.nota) END));
END$$

DELIMITER ;

-- ============================== VISTAS ==============================

CREATE VIEW v_stock_producto AS
SELECT p.id AS producto_id, p.sku, p.nombre, p.categoria_id, p.stock_minimo, p.costo, p.precio, p.activo,
       COALESCE(SUM(e.cantidad), 0) AS stock_total
FROM productos p
LEFT JOIN existencias e ON e.producto_id = p.id
GROUP BY p.id, p.sku, p.nombre, p.categoria_id, p.stock_minimo, p.costo, p.precio, p.activo;

CREATE VIEW v_stock_bajo AS
SELECT s.producto_id, s.sku, s.nombre, c.nombre AS categoria, s.stock_total, s.stock_minimo,
       s.stock_minimo - s.stock_total AS faltante
FROM v_stock_producto s
JOIN categorias c ON c.id = s.categoria_id
WHERE s.activo = 1 AND s.stock_total < s.stock_minimo;

CREATE VIEW v_valor_inventario AS
SELECT p.id AS producto_id, p.sku, p.nombre, c.nombre AS categoria, b.codigo AS bodega,
       e.cantidad, e.cantidad * p.costo AS valor_costo, e.cantidad * p.precio AS valor_venta
FROM existencias e
JOIN productos p ON p.id = e.producto_id
JOIN categorias c ON c.id = p.categoria_id
JOIN bodegas b ON b.id = e.bodega_id
WHERE e.cantidad > 0;

CREATE VIEW v_pedidos_totales AS
SELECT p.id AS pedido_id, p.numero, p.estado, p.fecha, p.cliente_id,
       COUNT(l.id) AS lineas,
       COALESCE(SUM(l.cantidad), 0) AS unidades,
       COALESCE(SUM(l.cantidad * l.precio_unitario), 0) AS total
FROM pedidos p
LEFT JOIN pedido_lineas l ON l.pedido_id = p.id
GROUP BY p.id, p.numero, p.estado, p.fecha, p.cliente_id;

CREATE VIEW v_ordenes_totales AS
SELECT o.id AS orden_id, o.numero, o.estado, o.fecha, o.proveedor_id,
       COUNT(l.id) AS lineas,
       COALESCE(SUM(l.cantidad_pedida), 0) AS unidades_pedidas,
       COALESCE(SUM(l.cantidad_recibida), 0) AS unidades_recibidas,
       COALESCE(SUM(l.cantidad_pedida * l.costo_unitario), 0) AS total
FROM ordenes_compra o
LEFT JOIN compra_lineas l ON l.orden_id = o.id
GROUP BY o.id, o.numero, o.estado, o.fecha, o.proveedor_id;

CREATE VIEW v_ventas_producto AS
SELECT p.id AS producto_id, p.sku, p.nombre,
       SUM(l.cantidad) AS unidades,
       SUM(l.cantidad * l.precio_unitario) AS ingresos,
       SUM(l.cantidad * p.costo) AS costo_estimado,
       SUM(l.cantidad * (l.precio_unitario - p.costo)) AS margen
FROM pedido_lineas l
JOIN pedidos pe ON pe.id = l.pedido_id AND pe.estado IN ('confirmado', 'despachado')
JOIN productos p ON p.id = l.producto_id
GROUP BY p.id, p.sku, p.nombre;

CREATE VIEW v_ventas_cliente AS
SELECT c.id AS cliente_id, c.nombre, c.documento,
       COUNT(DISTINCT pe.id) AS pedidos,
       SUM(l.cantidad * l.precio_unitario) AS ingresos
FROM pedidos pe
JOIN clientes c ON c.id = pe.cliente_id
JOIN pedido_lineas l ON l.pedido_id = pe.id
WHERE pe.estado IN ('confirmado', 'despachado')
GROUP BY c.id, c.nombre, c.documento;

CREATE VIEW v_rotacion AS
SELECT s.producto_id, s.sku, s.nombre, s.stock_total,
       COALESCE(-SUM(CASE WHEN m.referencia_tipo = 'pedido' THEN m.cantidad END), 0) AS unidades_salidas,
       ROUND(COALESCE(-SUM(CASE WHEN m.referencia_tipo = 'pedido' THEN m.cantidad END), 0) * 1.0
             / NULLIF(s.stock_total, 0), 2) AS indice_rotacion
FROM v_stock_producto s
LEFT JOIN movimientos m ON m.producto_id = s.producto_id
GROUP BY s.producto_id, s.sku, s.nombre, s.stock_total;

CREATE VIEW v_movimientos_detalle AS
SELECT m.id, m.fecha, m.tipo, p.sku, p.nombre AS producto, b.codigo AS bodega, m.cantidad,
       m.referencia_tipo, m.referencia_id, u.nombre AS usuario, m.nota
FROM movimientos m
JOIN productos p ON p.id = m.producto_id
JOIN bodegas b ON b.id = m.bodega_id
JOIN usuarios u ON u.id = m.usuario_id;
