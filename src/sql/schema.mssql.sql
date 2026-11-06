-- ============================================================================
-- Bodega · esquema para SQL Server 2019 o superior (T-SQL)
-- Traducción escrita a mano del esquema SQLite de la aplicación.
--
-- Diferencias frente a SQLite (resumen; el detalle está en docs/MODELO_DE_DATOS.md):
--   * IDENTITY(1,1) en lugar de AUTOINCREMENT; NVARCHAR, DATETIME2 y BIT.
--   * SQL Server no tiene triggers BEFORE: los triggers son AFTER y validan con THROW,
--     lo que revierte la sentencia (y la transacción) completa.
--   * Los triggers son por conjunto (tablas `inserted` y `deleted`), no por fila, así que
--     las reglas de estado y de stock se escriben con JOIN/EXISTS en vez de WHEN.
--   * Para tener un solo trigger de UPDATE por tabla, las reglas de estado y sus efectos
--     se agrupan (trg_pedidos_estado, trg_ordenes_estado) en lugar de uno por regla.
--   * Los triggers se crean DESPUÉS de cargar los datos de ejemplo para no duplicar movimientos.
--
-- Uso:  sqlcmd -S . -E -i schema.mssql.sql
-- ============================================================================

IF DB_ID(N'bodega') IS NULL CREATE DATABASE bodega COLLATE Latin1_General_100_CI_AI_SC_UTF8;
GO
USE bodega;
GO

IF OBJECT_ID(N'v_movimientos_detalle') IS NOT NULL DROP VIEW v_movimientos_detalle;
IF OBJECT_ID(N'v_rotacion') IS NOT NULL DROP VIEW v_rotacion;
IF OBJECT_ID(N'v_ventas_cliente') IS NOT NULL DROP VIEW v_ventas_cliente;
IF OBJECT_ID(N'v_ventas_producto') IS NOT NULL DROP VIEW v_ventas_producto;
IF OBJECT_ID(N'v_ordenes_totales') IS NOT NULL DROP VIEW v_ordenes_totales;
IF OBJECT_ID(N'v_pedidos_totales') IS NOT NULL DROP VIEW v_pedidos_totales;
IF OBJECT_ID(N'v_valor_inventario') IS NOT NULL DROP VIEW v_valor_inventario;
IF OBJECT_ID(N'v_stock_bajo') IS NOT NULL DROP VIEW v_stock_bajo;
IF OBJECT_ID(N'v_stock_producto') IS NOT NULL DROP VIEW v_stock_producto;
DROP TABLE IF EXISTS movimientos, ajustes, traslados, recepciones, compra_lineas, ordenes_compra, pedido_lineas,
                     pedidos, clientes, existencias, productos, bodegas, proveedores, categorias, usuarios, roles;
GO

-- ============================== TABLAS ==============================

CREATE TABLE roles (
  id          INT NOT NULL PRIMARY KEY,
  nombre      NVARCHAR(20) NOT NULL UNIQUE,
  descripcion NVARCHAR(200) NOT NULL,
  CONSTRAINT ck_roles_nombre CHECK (nombre IN (N'administrador', N'vendedor', N'bodeguero'))
);

CREATE TABLE usuarios (
  id     INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  nombre NVARCHAR(80) NOT NULL,
  email  NVARCHAR(120) NOT NULL UNIQUE,
  rol_id INT NOT NULL,
  activo BIT NOT NULL DEFAULT 1,
  CONSTRAINT ck_usuarios_nombre CHECK (LEN(LTRIM(RTRIM(nombre))) > 0),
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles (id)
);

CREATE TABLE categorias (
  id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  nombre      NVARCHAR(60) NOT NULL UNIQUE,
  descripcion NVARCHAR(200) NOT NULL DEFAULT N'',
  CONSTRAINT ck_categorias_nombre CHECK (LEN(LTRIM(RTRIM(nombre))) > 0)
);

CREATE TABLE proveedores (
  id       INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  nombre   NVARCHAR(120) NOT NULL,
  nit      NVARCHAR(30) NOT NULL UNIQUE,
  contacto NVARCHAR(80) NOT NULL DEFAULT N'',
  email    NVARCHAR(120) NOT NULL DEFAULT N'',
  telefono NVARCHAR(20) NOT NULL DEFAULT N'',
  ciudad   NVARCHAR(60) NOT NULL DEFAULT N'',
  activo   BIT NOT NULL DEFAULT 1,
  CONSTRAINT ck_proveedores_nombre CHECK (LEN(LTRIM(RTRIM(nombre))) > 0)
);

CREATE TABLE bodegas (
  id     INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  codigo NVARCHAR(10) NOT NULL UNIQUE,
  nombre NVARCHAR(80) NOT NULL,
  ciudad NVARCHAR(60) NOT NULL DEFAULT N'',
  activa BIT NOT NULL DEFAULT 1,
  CONSTRAINT ck_bodegas_codigo CHECK (LEN(codigo) BETWEEN 2 AND 10)
);

CREATE TABLE productos (
  id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  sku          NVARCHAR(20) NOT NULL,
  nombre       NVARCHAR(120) NOT NULL,
  descripcion  NVARCHAR(400) NOT NULL DEFAULT N'',
  categoria_id INT NOT NULL,
  proveedor_id INT NULL,
  unidad       NVARCHAR(12) NOT NULL DEFAULT N'und',
  costo        INT NOT NULL,
  precio       INT NOT NULL,
  stock_minimo INT NOT NULL DEFAULT 0,
  activo       BIT NOT NULL DEFAULT 1,
  creado_en    DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
  CONSTRAINT uq_productos_sku UNIQUE (sku),
  -- La comparación binaria evita que 'abc' pase por 'ABC' con la intercalación insensible a mayúsculas.
  CONSTRAINT ck_productos_sku CHECK (LEN(sku) BETWEEN 3 AND 20
        AND (sku COLLATE Latin1_General_100_BIN2) NOT LIKE N'%[^A-Z0-9-]%'),
  CONSTRAINT ck_productos_nombre CHECK (LEN(LTRIM(RTRIM(nombre))) > 0),
  CONSTRAINT ck_productos_costo CHECK (costo >= 0),
  CONSTRAINT ck_productos_precio CHECK (precio > 0),
  CONSTRAINT ck_productos_minimo CHECK (stock_minimo >= 0),
  CONSTRAINT fk_productos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias (id),
  CONSTRAINT fk_productos_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores (id)
);
CREATE INDEX idx_productos_categoria ON productos (categoria_id);
CREATE INDEX idx_productos_proveedor ON productos (proveedor_id);

CREATE TABLE existencias (
  producto_id INT NOT NULL,
  bodega_id   INT NOT NULL,
  cantidad    INT NOT NULL DEFAULT 0,
  CONSTRAINT pk_existencias PRIMARY KEY (producto_id, bodega_id),
  CONSTRAINT ck_existencias_cantidad CHECK (cantidad >= 0),
  CONSTRAINT fk_existencias_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_existencias_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id)
);
CREATE INDEX idx_existencias_bodega ON existencias (bodega_id);

CREATE TABLE clientes (
  id        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  nombre    NVARCHAR(120) NOT NULL,
  documento NVARCHAR(30) NOT NULL UNIQUE,
  email     NVARCHAR(120) NOT NULL DEFAULT N'',
  telefono  NVARCHAR(20) NOT NULL DEFAULT N'',
  ciudad    NVARCHAR(60) NOT NULL DEFAULT N'',
  activo    BIT NOT NULL DEFAULT 1,
  CONSTRAINT ck_clientes_nombre CHECK (LEN(LTRIM(RTRIM(nombre))) > 0)
);

CREATE TABLE pedidos (
  id                 INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  numero             NVARCHAR(20) NOT NULL UNIQUE,
  cliente_id         INT NOT NULL,
  usuario_id         INT NOT NULL,
  bodega_id          INT NOT NULL,
  estado             NVARCHAR(12) NOT NULL DEFAULT N'borrador',
  fecha              DATETIME2(0) NOT NULL,
  fecha_confirmacion DATETIME2(0) NULL,
  fecha_despacho     DATETIME2(0) NULL,
  fecha_anulacion    DATETIME2(0) NULL,
  notas              NVARCHAR(300) NOT NULL DEFAULT N'',
  CONSTRAINT ck_pedidos_estado CHECK (estado IN (N'borrador', N'confirmado', N'despachado', N'anulado')),
  CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_pedidos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_pedidos_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id)
);
CREATE INDEX idx_pedidos_cliente ON pedidos (cliente_id);
CREATE INDEX idx_pedidos_estado_fecha ON pedidos (estado, fecha);

CREATE TABLE pedido_lineas (
  id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  pedido_id       INT NOT NULL,
  producto_id     INT NOT NULL,
  cantidad        INT NOT NULL,
  precio_unitario INT NOT NULL,
  CONSTRAINT uq_pedido_producto UNIQUE (pedido_id, producto_id),
  CONSTRAINT ck_pl_cantidad CHECK (cantidad > 0),
  CONSTRAINT ck_pl_precio CHECK (precio_unitario >= 0),
  CONSTRAINT fk_pl_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE CASCADE,
  CONSTRAINT fk_pl_producto FOREIGN KEY (producto_id) REFERENCES productos (id)
);
CREATE INDEX idx_pedido_lineas_producto ON pedido_lineas (producto_id);

CREATE TABLE ordenes_compra (
  id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  numero       NVARCHAR(20) NOT NULL UNIQUE,
  proveedor_id INT NOT NULL,
  bodega_id    INT NOT NULL,
  usuario_id   INT NOT NULL,
  estado       NVARCHAR(12) NOT NULL DEFAULT N'borrador',
  fecha        DATETIME2(0) NOT NULL,
  notas        NVARCHAR(300) NOT NULL DEFAULT N'',
  CONSTRAINT ck_oc_estado CHECK (estado IN (N'borrador', N'enviada', N'parcial', N'recibida', N'anulada')),
  CONSTRAINT fk_oc_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores (id),
  CONSTRAINT fk_oc_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_oc_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
);
CREATE INDEX idx_ordenes_proveedor ON ordenes_compra (proveedor_id);

CREATE TABLE compra_lineas (
  id                INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
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
  CONSTRAINT fk_cl_producto FOREIGN KEY (producto_id) REFERENCES productos (id)
);
CREATE INDEX idx_compra_lineas_producto ON compra_lineas (producto_id);

CREATE TABLE recepciones (
  id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  linea_id   INT NOT NULL,
  cantidad   INT NOT NULL,
  fecha      DATETIME2(0) NOT NULL,
  usuario_id INT NOT NULL,
  nota       NVARCHAR(200) NOT NULL DEFAULT N'',
  CONSTRAINT ck_rec_cantidad CHECK (cantidad > 0),
  CONSTRAINT fk_rec_linea FOREIGN KEY (linea_id) REFERENCES compra_lineas (id),
  CONSTRAINT fk_rec_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
);
CREATE INDEX idx_recepciones_linea ON recepciones (linea_id);

CREATE TABLE traslados (
  id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  producto_id INT NOT NULL,
  origen_id   INT NOT NULL,
  destino_id  INT NOT NULL,
  cantidad    INT NOT NULL,
  fecha       DATETIME2(0) NOT NULL,
  usuario_id  INT NOT NULL,
  nota        NVARCHAR(200) NOT NULL DEFAULT N'',
  CONSTRAINT ck_tr_cantidad CHECK (cantidad > 0),
  CONSTRAINT ck_tr_bodegas CHECK (origen_id <> destino_id),
  CONSTRAINT fk_tr_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_tr_origen FOREIGN KEY (origen_id) REFERENCES bodegas (id),
  CONSTRAINT fk_tr_destino FOREIGN KEY (destino_id) REFERENCES bodegas (id),
  CONSTRAINT fk_tr_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
);

CREATE TABLE ajustes (
  id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  producto_id INT NOT NULL,
  bodega_id   INT NOT NULL,
  cantidad    INT NOT NULL,
  motivo      NVARCHAR(12) NOT NULL,
  fecha       DATETIME2(0) NOT NULL,
  usuario_id  INT NOT NULL,
  nota        NVARCHAR(200) NOT NULL DEFAULT N'',
  CONSTRAINT ck_aj_cantidad CHECK (cantidad <> 0),
  CONSTRAINT ck_aj_motivo CHECK (motivo IN (N'conteo', N'merma', N'daño', N'corrección')),
  CONSTRAINT fk_aj_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_aj_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_aj_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
);

-- Libro de movimientos: única vía por la que cambian las existencias.
CREATE TABLE movimientos (
  id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  fecha           DATETIME2(0) NOT NULL,
  tipo            NVARCHAR(16) NOT NULL,
  producto_id     INT NOT NULL,
  bodega_id       INT NOT NULL,
  cantidad        INT NOT NULL,
  referencia_tipo NVARCHAR(10) NOT NULL,
  referencia_id   INT NOT NULL,
  usuario_id      INT NOT NULL,
  nota            NVARCHAR(200) NOT NULL DEFAULT N'',
  CONSTRAINT ck_mov_tipo CHECK (tipo IN (N'entrada', N'salida', N'ajuste', N'traslado_entrada', N'traslado_salida')),
  CONSTRAINT ck_mov_cantidad CHECK (cantidad <> 0),
  CONSTRAINT ck_mov_ref CHECK (referencia_tipo IN (N'pedido', N'compra', N'traslado', N'ajuste')),
  CONSTRAINT ck_mov_signo CHECK (
    (tipo IN (N'entrada', N'traslado_entrada') AND cantidad > 0) OR
    (tipo IN (N'salida', N'traslado_salida') AND cantidad < 0) OR
    tipo = N'ajuste'),
  CONSTRAINT fk_mov_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_mov_bodega FOREIGN KEY (bodega_id) REFERENCES bodegas (id),
  CONSTRAINT fk_mov_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
);
CREATE INDEX idx_movimientos_producto_fecha ON movimientos (producto_id, fecha);
CREATE INDEX idx_movimientos_fecha ON movimientos (fecha);
CREATE INDEX idx_movimientos_ref ON movimientos (referencia_tipo, referencia_id);
GO

-- ========================== DATOS DE EJEMPLO ==========================
-- (generados desde la misma semilla determinista que usa la aplicación)

-- @@DATOS@@

-- ============================== TRIGGERS ==============================

CREATE TRIGGER trg_productos_precio ON productos AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted WHERE precio < costo)
    THROW 50001, N'El precio de venta no puede ser menor al costo', 1;
END;
GO

-- El libro de movimientos es inmutable.
CREATE TRIGGER trg_mov_inmutable ON movimientos AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  THROW 50002, N'Los movimientos de inventario no se pueden modificar ni eliminar', 1;
END;
GO

-- Aplica cada movimiento a las existencias y rechaza dejar stock negativo.
CREATE TRIGGER trg_mov_aplicar ON movimientos AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM (SELECT producto_id, bodega_id, SUM(cantidad) AS delta FROM inserted GROUP BY producto_id, bodega_id) s
    LEFT JOIN existencias e ON e.producto_id = s.producto_id AND e.bodega_id = s.bodega_id
    WHERE ISNULL(e.cantidad, 0) + s.delta < 0)
    THROW 50003, N'Stock insuficiente: la operación dejaría la existencia en negativo', 1;

  INSERT INTO existencias (producto_id, bodega_id, cantidad)
  SELECT DISTINCT i.producto_id, i.bodega_id, 0
  FROM inserted i
  WHERE NOT EXISTS (SELECT 1 FROM existencias e WHERE e.producto_id = i.producto_id AND e.bodega_id = i.bodega_id);

  UPDATE e SET cantidad = e.cantidad + s.delta
  FROM existencias e
  JOIN (SELECT producto_id, bodega_id, SUM(cantidad) AS delta FROM inserted GROUP BY producto_id, bodega_id) s
    ON s.producto_id = e.producto_id AND s.bodega_id = e.bodega_id;
END;
GO

-- ---- Pedidos de venta ----

CREATE TRIGGER trg_pedidos_estado ON pedidos AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT UPDATE(estado) RETURN;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
    WHERE i.estado <> d.estado AND NOT (
      (d.estado = N'borrador' AND i.estado IN (N'confirmado', N'anulado')) OR
      (d.estado = N'confirmado' AND i.estado IN (N'despachado', N'anulado'))))
    THROW 50010, N'Transición de estado de pedido no permitida', 1;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
    WHERE i.estado = N'confirmado' AND d.estado = N'borrador'
      AND NOT EXISTS (SELECT 1 FROM pedido_lineas l WHERE l.pedido_id = i.id))
    THROW 50011, N'No se puede confirmar un pedido sin líneas', 1;

  -- Confirmar: descuenta el stock de la bodega del pedido (falla todo si alguna línea no alcanza).
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  SELECT COALESCE(i.fecha_confirmacion, SYSDATETIME()), N'salida', l.producto_id, i.bodega_id, -l.cantidad,
         N'pedido', i.id, i.usuario_id, N'Pedido ' + i.numero
  FROM inserted i JOIN deleted d ON d.id = i.id
  JOIN pedido_lineas l ON l.pedido_id = i.id
  WHERE i.estado = N'confirmado' AND d.estado = N'borrador';

  -- Anular un pedido confirmado: devuelve el stock.
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  SELECT COALESCE(i.fecha_anulacion, SYSDATETIME()), N'entrada', l.producto_id, i.bodega_id, l.cantidad,
         N'pedido', i.id, i.usuario_id, N'Anulación del pedido ' + i.numero
  FROM inserted i JOIN deleted d ON d.id = i.id
  JOIN pedido_lineas l ON l.pedido_id = i.id
  WHERE i.estado = N'anulado' AND d.estado = N'confirmado';
END;
GO

CREATE TRIGGER trg_pedidos_borrar ON pedidos AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted WHERE estado <> N'borrador')
    THROW 50012, N'Solo se pueden eliminar pedidos en borrador', 1;
END;
GO

-- Las líneas solo cambian mientras el pedido es un borrador.
CREATE TRIGGER trg_lineas_pedido ON pedido_lineas AFTER INSERT, UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1
    FROM (SELECT pedido_id FROM inserted UNION SELECT pedido_id FROM deleted) x
    JOIN pedidos p ON p.id = x.pedido_id
    WHERE p.estado <> N'borrador')
    THROW 50013, N'Solo se pueden modificar líneas de pedidos en borrador', 1;
END;
GO

-- ---- Órdenes de compra ----

CREATE TRIGGER trg_ordenes_estado ON ordenes_compra AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT UPDATE(estado) RETURN;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
    WHERE i.estado <> d.estado AND NOT (
      (d.estado = N'borrador' AND i.estado IN (N'enviada', N'anulada')) OR
      (d.estado = N'enviada' AND i.estado IN (N'parcial', N'recibida', N'anulada')) OR
      (d.estado = N'parcial' AND i.estado = N'recibida')))
    THROW 50020, N'Transición de estado de orden de compra no permitida', 1;

  IF EXISTS (
    SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
    WHERE i.estado = N'enviada' AND d.estado = N'borrador'
      AND NOT EXISTS (SELECT 1 FROM compra_lineas l WHERE l.orden_id = i.id))
    THROW 50021, N'No se puede enviar una orden sin líneas', 1;
END;
GO

CREATE TRIGGER trg_ordenes_borrar ON ordenes_compra AFTER DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted WHERE estado <> N'borrador')
    THROW 50022, N'Solo se pueden eliminar órdenes en borrador', 1;
END;
GO

-- Recibir mercancía (cantidad_recibida) sí está permitido; lo demás solo en borrador.
CREATE TRIGGER trg_compra_lineas ON compra_lineas AFTER INSERT, UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1
    FROM inserted i
    JOIN ordenes_compra o ON o.id = i.orden_id
    LEFT JOIN deleted d ON d.id = i.id
    WHERE o.estado <> N'borrador'
      AND (d.id IS NULL OR d.producto_id <> i.producto_id OR d.cantidad_pedida <> i.cantidad_pedida
           OR d.costo_unitario <> i.costo_unitario))
    THROW 50023, N'Solo se pueden modificar líneas de órdenes en borrador', 1;

  IF EXISTS (
    SELECT 1 FROM deleted d
    JOIN ordenes_compra o ON o.id = d.orden_id
    WHERE o.estado <> N'borrador' AND NOT EXISTS (SELECT 1 FROM inserted i WHERE i.id = d.id))
    THROW 50023, N'Solo se pueden modificar líneas de órdenes en borrador', 1;
END;
GO

-- ---- Recepciones: valida, suma al stock y actualiza el estado de la orden ----

CREATE TRIGGER trg_recepciones_aplicar ON recepciones AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN compra_lineas l ON l.id = i.linea_id
    JOIN ordenes_compra o ON o.id = l.orden_id
    WHERE o.estado NOT IN (N'enviada', N'parcial'))
    THROW 50030, N'La orden de compra no admite recepciones en su estado actual', 1;

  IF EXISTS (
    SELECT 1
    FROM (SELECT linea_id, SUM(cantidad) AS suma FROM inserted GROUP BY linea_id) s
    JOIN compra_lineas l ON l.id = s.linea_id
    WHERE s.suma > l.cantidad_pedida - l.cantidad_recibida)
    THROW 50031, N'La cantidad recibida supera lo pendiente de la línea', 1;

  UPDATE l SET cantidad_recibida = l.cantidad_recibida + s.suma
  FROM compra_lineas l
  JOIN (SELECT linea_id, SUM(cantidad) AS suma FROM inserted GROUP BY linea_id) s ON s.linea_id = l.id;

  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  SELECT i.fecha, N'entrada', l.producto_id, o.bodega_id, i.cantidad, N'compra', o.id, i.usuario_id,
         N'Recepción de la orden ' + o.numero
  FROM inserted i
  JOIN compra_lineas l ON l.id = i.linea_id
  JOIN ordenes_compra o ON o.id = l.orden_id;

  UPDATE o SET estado = CASE
      WHEN EXISTS (SELECT 1 FROM compra_lineas c WHERE c.orden_id = o.id AND c.cantidad_recibida < c.cantidad_pedida)
      THEN N'parcial' ELSE N'recibida' END
  FROM ordenes_compra o
  WHERE o.id IN (SELECT l.orden_id FROM inserted i JOIN compra_lineas l ON l.id = i.linea_id);
END;
GO

-- ---- Traslados y ajustes ----

CREATE TRIGGER trg_traslados_aplicar ON traslados AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  SELECT fecha, N'traslado_salida', producto_id, origen_id, -cantidad, N'traslado', id, usuario_id, nota FROM inserted;
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  SELECT fecha, N'traslado_entrada', producto_id, destino_id, cantidad, N'traslado', id, usuario_id, nota FROM inserted;
END;
GO

CREATE TRIGGER trg_ajustes_aplicar ON ajustes AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO movimientos (fecha, tipo, producto_id, bodega_id, cantidad, referencia_tipo, referencia_id, usuario_id, nota)
  SELECT fecha, N'ajuste', producto_id, bodega_id, cantidad, N'ajuste', id, usuario_id,
         motivo + CASE WHEN nota = N'' THEN N'' ELSE N': ' + nota END
  FROM inserted;
END;
GO

-- ============================== VISTAS ==============================

CREATE VIEW v_stock_producto AS
SELECT p.id AS producto_id, p.sku, p.nombre, p.categoria_id, p.stock_minimo, p.costo, p.precio, p.activo,
       COALESCE(SUM(e.cantidad), 0) AS stock_total
FROM productos p
LEFT JOIN existencias e ON e.producto_id = p.id
GROUP BY p.id, p.sku, p.nombre, p.categoria_id, p.stock_minimo, p.costo, p.precio, p.activo;
GO

CREATE VIEW v_stock_bajo AS
SELECT s.producto_id, s.sku, s.nombre, c.nombre AS categoria, s.stock_total, s.stock_minimo,
       s.stock_minimo - s.stock_total AS faltante
FROM v_stock_producto s
JOIN categorias c ON c.id = s.categoria_id
WHERE s.activo = 1 AND s.stock_total < s.stock_minimo;
GO

CREATE VIEW v_valor_inventario AS
SELECT p.id AS producto_id, p.sku, p.nombre, c.nombre AS categoria, b.codigo AS bodega,
       e.cantidad, CAST(e.cantidad AS BIGINT) * p.costo AS valor_costo, CAST(e.cantidad AS BIGINT) * p.precio AS valor_venta
FROM existencias e
JOIN productos p ON p.id = e.producto_id
JOIN categorias c ON c.id = p.categoria_id
JOIN bodegas b ON b.id = e.bodega_id
WHERE e.cantidad > 0;
GO

CREATE VIEW v_pedidos_totales AS
SELECT p.id AS pedido_id, p.numero, p.estado, p.fecha, p.cliente_id,
       COUNT(l.id) AS lineas,
       COALESCE(SUM(l.cantidad), 0) AS unidades,
       COALESCE(SUM(CAST(l.cantidad AS BIGINT) * l.precio_unitario), 0) AS total
FROM pedidos p
LEFT JOIN pedido_lineas l ON l.pedido_id = p.id
GROUP BY p.id, p.numero, p.estado, p.fecha, p.cliente_id;
GO

CREATE VIEW v_ordenes_totales AS
SELECT o.id AS orden_id, o.numero, o.estado, o.fecha, o.proveedor_id,
       COUNT(l.id) AS lineas,
       COALESCE(SUM(l.cantidad_pedida), 0) AS unidades_pedidas,
       COALESCE(SUM(l.cantidad_recibida), 0) AS unidades_recibidas,
       COALESCE(SUM(CAST(l.cantidad_pedida AS BIGINT) * l.costo_unitario), 0) AS total
FROM ordenes_compra o
LEFT JOIN compra_lineas l ON l.orden_id = o.id
GROUP BY o.id, o.numero, o.estado, o.fecha, o.proveedor_id;
GO

CREATE VIEW v_ventas_producto AS
SELECT p.id AS producto_id, p.sku, p.nombre,
       SUM(l.cantidad) AS unidades,
       SUM(CAST(l.cantidad AS BIGINT) * l.precio_unitario) AS ingresos,
       SUM(CAST(l.cantidad AS BIGINT) * p.costo) AS costo_estimado,
       SUM(CAST(l.cantidad AS BIGINT) * (l.precio_unitario - p.costo)) AS margen
FROM pedido_lineas l
JOIN pedidos pe ON pe.id = l.pedido_id AND pe.estado IN (N'confirmado', N'despachado')
JOIN productos p ON p.id = l.producto_id
GROUP BY p.id, p.sku, p.nombre;
GO

CREATE VIEW v_ventas_cliente AS
SELECT c.id AS cliente_id, c.nombre, c.documento,
       COUNT(DISTINCT pe.id) AS pedidos,
       SUM(CAST(l.cantidad AS BIGINT) * l.precio_unitario) AS ingresos
FROM pedidos pe
JOIN clientes c ON c.id = pe.cliente_id
JOIN pedido_lineas l ON l.pedido_id = pe.id
WHERE pe.estado IN (N'confirmado', N'despachado')
GROUP BY c.id, c.nombre, c.documento;
GO

CREATE VIEW v_rotacion AS
SELECT s.producto_id, s.sku, s.nombre, s.stock_total,
       COALESCE(-SUM(CASE WHEN m.referencia_tipo = N'pedido' THEN m.cantidad END), 0) AS unidades_salidas,
       ROUND(COALESCE(-SUM(CASE WHEN m.referencia_tipo = N'pedido' THEN m.cantidad END), 0) * 1.0
             / NULLIF(s.stock_total, 0), 2) AS indice_rotacion
FROM v_stock_producto s
LEFT JOIN movimientos m ON m.producto_id = s.producto_id
GROUP BY s.producto_id, s.sku, s.nombre, s.stock_total;
GO

CREATE VIEW v_movimientos_detalle AS
SELECT m.id, m.fecha, m.tipo, p.sku, p.nombre AS producto, b.codigo AS bodega, m.cantidad,
       m.referencia_tipo, m.referencia_id, u.nombre AS usuario, m.nota
FROM movimientos m
JOIN productos p ON p.id = m.producto_id
JOIN bodegas b ON b.id = m.bodega_id
JOIN usuarios u ON u.id = m.usuario_id;
GO
