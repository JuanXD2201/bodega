-- Bodega · esquema SQLite (versión 1)
-- Dinero en pesos colombianos como enteros. Fechas en texto 'AAAA-MM-DD HH:MM:SS'.
-- Las claves foráneas se activan por conexión con PRAGMA foreign_keys = ON.

-- ============================== TABLAS ==============================

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE
              CHECK (nombre IN ('administrador', 'vendedor', 'bodeguero')),
  descripcion TEXT NOT NULL
);

CREATE TABLE usuarios (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  email  TEXT NOT NULL UNIQUE,
  rol_id INTEGER NOT NULL REFERENCES roles (id),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
);

CREATE TABLE categorias (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL UNIQUE CHECK (length(trim(nombre)) > 0),
  descripcion TEXT NOT NULL DEFAULT ''
);

CREATE TABLE proveedores (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre   TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  nit      TEXT NOT NULL UNIQUE CHECK (length(trim(nit)) > 0),
  contacto TEXT NOT NULL DEFAULT '',
  email    TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  ciudad   TEXT NOT NULL DEFAULT '',
  activo   INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
);

CREATE TABLE bodegas (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE CHECK (length(codigo) BETWEEN 2 AND 10),
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  ciudad TEXT NOT NULL DEFAULT '',
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1))
);

CREATE TABLE productos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT NOT NULL UNIQUE
               CHECK (length(sku) BETWEEN 3 AND 20 AND sku NOT GLOB '*[^A-Z0-9-]*'),
  nombre       TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  descripcion  TEXT NOT NULL DEFAULT '',
  categoria_id INTEGER NOT NULL REFERENCES categorias (id),
  proveedor_id INTEGER REFERENCES proveedores (id),
  unidad       TEXT NOT NULL DEFAULT 'und' CHECK (length(trim(unidad)) > 0),
  costo        INTEGER NOT NULL CHECK (costo >= 0),
  precio       INTEGER NOT NULL CHECK (precio > 0),
  stock_minimo INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  activo       INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE existencias (
  producto_id INTEGER NOT NULL REFERENCES productos (id),
  bodega_id   INTEGER NOT NULL REFERENCES bodegas (id),
  cantidad    INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  PRIMARY KEY (producto_id, bodega_id)
) WITHOUT ROWID;

CREATE TABLE clientes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  documento TEXT NOT NULL UNIQUE CHECK (length(trim(documento)) > 0),
  email     TEXT NOT NULL DEFAULT '',
  telefono  TEXT NOT NULL DEFAULT '',
  ciudad    TEXT NOT NULL DEFAULT '',
  activo    INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
);

CREATE TABLE pedidos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  numero             TEXT NOT NULL UNIQUE,
  cliente_id         INTEGER NOT NULL REFERENCES clientes (id),
  usuario_id         INTEGER NOT NULL REFERENCES usuarios (id),
  bodega_id          INTEGER NOT NULL REFERENCES bodegas (id),
  estado             TEXT NOT NULL DEFAULT 'borrador'
                     CHECK (estado IN ('borrador', 'confirmado', 'despachado', 'anulado')),
  fecha              TEXT NOT NULL,
  fecha_confirmacion TEXT,
  fecha_despacho     TEXT,
  fecha_anulacion    TEXT,
  notas              TEXT NOT NULL DEFAULT ''
);

CREATE TABLE pedido_lineas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id       INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  producto_id     INTEGER NOT NULL REFERENCES productos (id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario INTEGER NOT NULL CHECK (precio_unitario >= 0),
  UNIQUE (pedido_id, producto_id)
);

CREATE TABLE ordenes_compra (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  numero      TEXT NOT NULL UNIQUE,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores (id),
  bodega_id   INTEGER NOT NULL REFERENCES bodegas (id),
  usuario_id  INTEGER NOT NULL REFERENCES usuarios (id),
  estado      TEXT NOT NULL DEFAULT 'borrador'
              CHECK (estado IN ('borrador', 'enviada', 'parcial', 'recibida', 'anulada')),
  fecha       TEXT NOT NULL,
  notas       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE compra_lineas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id          INTEGER NOT NULL REFERENCES ordenes_compra (id) ON DELETE CASCADE,
  producto_id       INTEGER NOT NULL REFERENCES productos (id),
  cantidad_pedida   INTEGER NOT NULL CHECK (cantidad_pedida > 0),
  cantidad_recibida INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0),
  costo_unitario    INTEGER NOT NULL CHECK (costo_unitario >= 0),
  UNIQUE (orden_id, producto_id),
  CHECK (cantidad_recibida <= cantidad_pedida)
);

CREATE TABLE recepciones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  linea_id   INTEGER NOT NULL REFERENCES compra_lineas (id),
  cantidad   INTEGER NOT NULL CHECK (cantidad > 0),
  fecha      TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id),
  nota       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE traslados (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos (id),
  origen_id  INTEGER NOT NULL REFERENCES bodegas (id),
  destino_id INTEGER NOT NULL REFERENCES bodegas (id),
  cantidad   INTEGER NOT NULL CHECK (cantidad > 0),
  fecha      TEXT NOT NULL,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id),
  nota       TEXT NOT NULL DEFAULT '',
  CHECK (origen_id <> destino_id)
);

CREATE TABLE ajustes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos (id),
  bodega_id   INTEGER NOT NULL REFERENCES bodegas (id),
  cantidad    INTEGER NOT NULL CHECK (cantidad <> 0),
  motivo      TEXT NOT NULL CHECK (motivo IN ('conteo', 'merma', 'daño', 'corrección')),
  fecha       TEXT NOT NULL,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios (id),
  nota        TEXT NOT NULL DEFAULT ''
);

-- Libro de movimientos: única vía por la que cambian las existencias.
CREATE TABLE movimientos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha           TEXT NOT NULL,
  tipo            TEXT NOT NULL
                  CHECK (tipo IN ('entrada', 'salida', 'ajuste', 'traslado_entrada', 'traslado_salida')),
  producto_id     INTEGER NOT NULL REFERENCES productos (id),
  bodega_id       INTEGER NOT NULL REFERENCES bodegas (id),
  cantidad        INTEGER NOT NULL CHECK (cantidad <> 0),
  referencia_tipo TEXT NOT NULL CHECK (referencia_tipo IN ('pedido', 'compra', 'traslado', 'ajuste')),
  referencia_id   INTEGER NOT NULL,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios (id),
  nota            TEXT NOT NULL DEFAULT '',
  CHECK (
    (tipo IN ('entrada', 'traslado_entrada') AND cantidad > 0) OR
    (tipo IN ('salida', 'traslado_salida') AND cantidad < 0) OR
    tipo = 'ajuste'
  )
);

-- ============================== ÍNDICES ==============================

CREATE INDEX idx_productos_categoria ON productos (categoria_id);
CREATE INDEX idx_productos_proveedor ON productos (proveedor_id);
CREATE INDEX idx_existencias_bodega ON existencias (bodega_id);
CREATE INDEX idx_pedidos_cliente ON pedidos (cliente_id);
CREATE INDEX idx_pedidos_estado_fecha ON pedidos (estado, fecha);
CREATE INDEX idx_pedido_lineas_producto ON pedido_lineas (producto_id);
CREATE INDEX idx_ordenes_proveedor ON ordenes_compra (proveedor_id);
CREATE INDEX idx_compra_lineas_producto ON compra_lineas (producto_id);
CREATE INDEX idx_recepciones_linea ON recepciones (linea_id);
CREATE INDEX idx_movimientos_producto_fecha ON movimientos (producto_id, fecha);
CREATE INDEX idx_movimientos_fecha ON movimientos (fecha);
CREATE INDEX idx_movimientos_ref ON movimientos (referencia_tipo, referencia_id);

-- ============================== TRIGGERS ==============================

-- Precios coherentes: nunca vender por debajo del costo.
CREATE TRIGGER trg_productos_precio_ins BEFORE INSERT ON productos
WHEN NEW.precio < NEW.costo
BEGIN
  SELECT RAISE(ABORT, 'El precio de venta no puede ser menor al costo');
END;

CREATE TRIGGER trg_productos_precio_upd BEFORE UPDATE OF precio, costo ON productos
WHEN NEW.precio < NEW.costo
BEGIN
  SELECT RAISE(ABORT, 'El precio de venta no puede ser menor al costo');
END;

-- El libro de movimientos es inmutable.
CREATE TRIGGER trg_mov_inmutable_upd BEFORE UPDATE ON movimientos
BEGIN
  SELECT RAISE(ABORT, 'Los movimientos de inventario no se pueden modificar');
END;

CREATE TRIGGER trg_mov_inmutable_del BEFORE DELETE ON movimientos
BEGIN
  SELECT RAISE(ABORT, 'Los movimientos de inventario no se pueden eliminar');
END;

-- Nunca se permite dejar una existencia por debajo de cero.
CREATE TRIGGER trg_mov_stock_suficiente BEFORE INSERT ON movimientos
WHEN NEW.cantidad < 0
 AND COALESCE((SELECT cantidad FROM existencias
               WHERE producto_id = NEW.producto_id AND bodega_id = NEW.bodega_id), 0) + NEW.cantidad < 0
BEGIN
  SELECT RAISE(ABORT, 'Stock insuficiente: la operación dejaría la existencia en negativo');
END;

-- Cada movimiento aplica su efecto sobre las existencias.
CREATE TRIGGER trg_mov_aplicar AFTER INSERT ON movimientos
BEGIN
  INSERT OR IGNORE INTO existencias (producto_id, bodega_id, cantidad)
  VALUES (NEW.producto_id, NEW.bodega_id, 0);
  UPDATE existencias SET cantidad = cantidad + NEW.cantidad
  WHERE producto_id = NEW.producto_id AND bodega_id = NEW.bodega_id;
END;

-- ---- Pedidos de venta ----

CREATE TRIGGER trg_pedidos_transicion BEFORE UPDATE OF estado ON pedidos
WHEN OLD.estado <> NEW.estado AND NOT (
     (OLD.estado = 'borrador'   AND NEW.estado IN ('confirmado', 'anulado')) OR
     (OLD.estado = 'confirmado' AND NEW.estado IN ('despachado', 'anulado')))
BEGIN
  SELECT RAISE(ABORT, 'Transición de estado de pedido no permitida');
END;

CREATE TRIGGER trg_pedidos_sin_lineas BEFORE UPDATE OF estado ON pedidos
WHEN NEW.estado = 'confirmado' AND OLD.estado = 'borrador'
 AND NOT EXISTS (SELECT 1 FROM pedido_lineas WHERE pedido_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'No se puede confirmar un pedido sin líneas');
END;

CREATE TRIGGER trg_pedidos_borrar BEFORE DELETE ON pedidos
WHEN OLD.estado <> 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Solo se pueden eliminar pedidos en borrador');
END;

-- Confirmar descuenta el stock de la bodega del pedido, línea por línea.
-- Si una línea no tiene stock, el trigger de movimientos aborta y se revierte todo.
CREATE TRIGGER trg_pedidos_confirmar AFTER UPDATE OF estado ON pedidos
WHEN NEW.estado = 'confirmado' AND OLD.estado = 'borrador'
BEGIN
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad,
                           referencia_tipo, referencia_id, usuario_id, nota)
  SELECT COALESCE(NEW.fecha_confirmacion, datetime('now')), 'salida', l.producto_id, NEW.bodega_id,
         -l.cantidad, 'pedido', NEW.id, NEW.usuario_id, 'Pedido ' || NEW.numero
  FROM pedido_lineas l WHERE l.pedido_id = NEW.id ORDER BY l.id;
END;

-- Anular un pedido confirmado devuelve el stock a la bodega.
CREATE TRIGGER trg_pedidos_anular AFTER UPDATE OF estado ON pedidos
WHEN NEW.estado = 'anulado' AND OLD.estado = 'confirmado'
BEGIN
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad,
                           referencia_tipo, referencia_id, usuario_id, nota)
  SELECT COALESCE(NEW.fecha_anulacion, datetime('now')), 'entrada', l.producto_id, NEW.bodega_id,
         l.cantidad, 'pedido', NEW.id, NEW.usuario_id, 'Anulación del pedido ' || NEW.numero
  FROM pedido_lineas l WHERE l.pedido_id = NEW.id ORDER BY l.id;
END;

-- Las líneas solo cambian mientras el pedido es un borrador.
CREATE TRIGGER trg_lineas_pedido_ins BEFORE INSERT ON pedido_lineas
WHEN (SELECT estado FROM pedidos WHERE id = NEW.pedido_id) <> 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Solo se pueden modificar líneas de pedidos en borrador');
END;

CREATE TRIGGER trg_lineas_pedido_upd BEFORE UPDATE ON pedido_lineas
WHEN (SELECT estado FROM pedidos WHERE id = OLD.pedido_id) <> 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Solo se pueden modificar líneas de pedidos en borrador');
END;

CREATE TRIGGER trg_lineas_pedido_del BEFORE DELETE ON pedido_lineas
WHEN (SELECT estado FROM pedidos WHERE id = OLD.pedido_id) <> 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Solo se pueden modificar líneas de pedidos en borrador');
END;

-- ---- Órdenes de compra ----

CREATE TRIGGER trg_ordenes_transicion BEFORE UPDATE OF estado ON ordenes_compra
WHEN OLD.estado <> NEW.estado AND NOT (
     (OLD.estado = 'borrador' AND NEW.estado IN ('enviada', 'anulada')) OR
     (OLD.estado = 'enviada'  AND NEW.estado IN ('parcial', 'recibida', 'anulada')) OR
     (OLD.estado = 'parcial'  AND NEW.estado = 'recibida'))
BEGIN
  SELECT RAISE(ABORT, 'Transición de estado de orden de compra no permitida');
END;

CREATE TRIGGER trg_ordenes_sin_lineas BEFORE UPDATE OF estado ON ordenes_compra
WHEN NEW.estado = 'enviada' AND OLD.estado = 'borrador'
 AND NOT EXISTS (SELECT 1 FROM compra_lineas WHERE orden_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'No se puede enviar una orden sin líneas');
END;

CREATE TRIGGER trg_ordenes_borrar BEFORE DELETE ON ordenes_compra
WHEN OLD.estado <> 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Solo se pueden eliminar órdenes en borrador');
END;

CREATE TRIGGER trg_compra_lineas_ins BEFORE INSERT ON compra_lineas
WHEN (SELECT estado FROM ordenes_compra WHERE id = NEW.orden_id) <> 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Solo se pueden modificar líneas de órdenes en borrador');
END;

CREATE TRIGGER trg_compra_lineas_upd BEFORE UPDATE OF producto_id, cantidad_pedida, costo_unitario ON compra_lineas
WHEN (SELECT estado FROM ordenes_compra WHERE id = OLD.orden_id) <> 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Solo se pueden modificar líneas de órdenes en borrador');
END;

CREATE TRIGGER trg_compra_lineas_del BEFORE DELETE ON compra_lineas
WHEN (SELECT estado FROM ordenes_compra WHERE id = OLD.orden_id) <> 'borrador'
BEGIN
  SELECT RAISE(ABORT, 'Solo se pueden modificar líneas de órdenes en borrador');
END;

-- Recepción: valida lo pendiente, suma al stock y actualiza el estado de la orden.
CREATE TRIGGER trg_recepciones_validar BEFORE INSERT ON recepciones
WHEN (SELECT o.estado FROM compra_lineas l JOIN ordenes_compra o ON o.id = l.orden_id
      WHERE l.id = NEW.linea_id) NOT IN ('enviada', 'parcial')
BEGIN
  SELECT RAISE(ABORT, 'La orden de compra no admite recepciones en su estado actual');
END;

CREATE TRIGGER trg_recepciones_pendiente BEFORE INSERT ON recepciones
WHEN NEW.cantidad > (SELECT cantidad_pedida - cantidad_recibida FROM compra_lineas WHERE id = NEW.linea_id)
BEGIN
  SELECT RAISE(ABORT, 'La cantidad recibida supera lo pendiente de la línea');
END;

CREATE TRIGGER trg_recepciones_aplicar AFTER INSERT ON recepciones
BEGIN
  UPDATE compra_lineas SET cantidad_recibida = cantidad_recibida + NEW.cantidad WHERE id = NEW.linea_id;

  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad,
                           referencia_tipo, referencia_id, usuario_id, nota)
  SELECT NEW.fecha, 'entrada', l.producto_id, o.bodega_id, NEW.cantidad,
         'compra', o.id, NEW.usuario_id, 'Recepción de la orden ' || o.numero
  FROM compra_lineas l JOIN ordenes_compra o ON o.id = l.orden_id
  WHERE l.id = NEW.linea_id;

  UPDATE ordenes_compra
     SET estado = CASE
       WHEN EXISTS (SELECT 1 FROM compra_lineas c
                    WHERE c.orden_id = ordenes_compra.id AND c.cantidad_recibida < c.cantidad_pedida)
       THEN 'parcial' ELSE 'recibida' END
   WHERE id = (SELECT orden_id FROM compra_lineas WHERE id = NEW.linea_id);
END;

-- ---- Traslados y ajustes ----

CREATE TRIGGER trg_traslados_aplicar AFTER INSERT ON traslados
BEGIN
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad,
                           referencia_tipo, referencia_id, usuario_id, nota)
  VALUES (NEW.fecha, 'traslado_salida', NEW.producto_id, NEW.origen_id, -NEW.cantidad,
          'traslado', NEW.id, NEW.usuario_id, NEW.nota);
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad,
                           referencia_tipo, referencia_id, usuario_id, nota)
  VALUES (NEW.fecha, 'traslado_entrada', NEW.producto_id, NEW.destino_id, NEW.cantidad,
          'traslado', NEW.id, NEW.usuario_id, NEW.nota);
END;

CREATE TRIGGER trg_ajustes_aplicar AFTER INSERT ON ajustes
BEGIN
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad,
                           referencia_tipo, referencia_id, usuario_id, nota)
  VALUES (NEW.fecha, 'ajuste', NEW.producto_id, NEW.bodega_id, NEW.cantidad,
          'ajuste', NEW.id, NEW.usuario_id, NEW.motivo || CASE WHEN NEW.nota = '' THEN '' ELSE ': ' || NEW.nota END);
END;

-- ============================== VISTAS ==============================

CREATE VIEW v_stock_producto AS
SELECT p.id AS producto_id, p.sku, p.nombre, p.categoria_id, p.stock_minimo, p.costo, p.precio, p.activo,
       COALESCE(SUM(e.cantidad), 0) AS stock_total
FROM productos p
LEFT JOIN existencias e ON e.producto_id = p.id
GROUP BY p.id;

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
GROUP BY p.id;

CREATE VIEW v_ordenes_totales AS
SELECT o.id AS orden_id, o.numero, o.estado, o.fecha, o.proveedor_id,
       COUNT(l.id) AS lineas,
       COALESCE(SUM(l.cantidad_pedida), 0) AS unidades_pedidas,
       COALESCE(SUM(l.cantidad_recibida), 0) AS unidades_recibidas,
       COALESCE(SUM(l.cantidad_pedida * l.costo_unitario), 0) AS total
FROM ordenes_compra o
LEFT JOIN compra_lineas l ON l.orden_id = o.id
GROUP BY o.id;

-- Ventas efectivas: pedidos confirmados o despachados.
CREATE VIEW v_ventas_producto AS
SELECT p.id AS producto_id, p.sku, p.nombre,
       SUM(l.cantidad) AS unidades,
       SUM(l.cantidad * l.precio_unitario) AS ingresos,
       SUM(l.cantidad * p.costo) AS costo_estimado,
       SUM(l.cantidad * (l.precio_unitario - p.costo)) AS margen
FROM pedido_lineas l
JOIN pedidos pe ON pe.id = l.pedido_id AND pe.estado IN ('confirmado', 'despachado')
JOIN productos p ON p.id = l.producto_id
GROUP BY p.id;

CREATE VIEW v_ventas_cliente AS
SELECT c.id AS cliente_id, c.nombre, c.documento,
       COUNT(DISTINCT pe.id) AS pedidos,
       SUM(l.cantidad * l.precio_unitario) AS ingresos
FROM pedidos pe
JOIN clientes c ON c.id = pe.cliente_id
JOIN pedido_lineas l ON l.pedido_id = pe.id
WHERE pe.estado IN ('confirmado', 'despachado')
GROUP BY c.id;

-- Rotación histórica: unidades vendidas netas (salidas menos anulaciones) frente al stock actual.
CREATE VIEW v_rotacion AS
SELECT s.producto_id, s.sku, s.nombre, s.stock_total,
       COALESCE(-SUM(CASE WHEN m.referencia_tipo = 'pedido' THEN m.cantidad END), 0) AS unidades_salidas,
       ROUND(COALESCE(-SUM(CASE WHEN m.referencia_tipo = 'pedido' THEN m.cantidad END), 0) * 1.0
             / NULLIF(s.stock_total, 0), 2) AS indice_rotacion
FROM v_stock_producto s
LEFT JOIN movimientos m ON m.producto_id = s.producto_id
GROUP BY s.producto_id;

CREATE VIEW v_movimientos_detalle AS
SELECT m.id, m.fecha, m.tipo, p.sku, p.nombre AS producto, b.codigo AS bodega, m.cantidad,
       m.referencia_tipo, m.referencia_id, u.nombre AS usuario, m.nota
FROM movimientos m
JOIN productos p ON p.id = m.producto_id
JOIN bodegas b ON b.id = m.bodega_id
JOIN usuarios u ON u.id = m.usuario_id;
