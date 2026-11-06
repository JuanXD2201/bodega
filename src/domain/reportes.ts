import { type Contexto, ErrorDominio, exigir, soloFecha, sumarDias } from './nucleo';

const VENTA = "pe.estado IN ('confirmado', 'despachado')";

export interface PuntoSerie { etiqueta: string; valor: number; extra?: number }

export interface DatosPanel {
  valorInventario: number;
  valorVentaPotencial: number;
  unidadesEnStock: number;
  productosActivos: number;
  stockBajo: number;
  pedidosPorConfirmar: number;
  pedidosPorDespachar: number;
  ventas30: number;
  ventasPrevias30: number;
  pedidos30: number;
  ordenesAbiertas: number;
  serieVentas: PuntoSerie[];
  topProductos: { sku: string; nombre: string; unidades: number; ingresos: number }[];
  alertas: { producto_id: number; sku: string; nombre: string; stock_total: number; stock_minimo: number }[];
  ultimosMovimientos: { id: number; fecha: string; tipo: string; sku: string; bodega: string; cantidad: number; nota: string }[];
}

function ventasEntre(ctx: Contexto, desde: string, hastaExcl: string): { total: number; pedidos: number } {
  const f = ctx.db.get<{ total: number | null; pedidos: number }>(
    `SELECT SUM(l.cantidad * l.precio_unitario) AS total, COUNT(DISTINCT pe.id) AS pedidos
     FROM pedidos pe JOIN pedido_lineas l ON l.pedido_id = pe.id
     WHERE ${VENTA} AND pe.fecha_confirmacion >= ? AND pe.fecha_confirmacion < ?`,
    [desde, hastaExcl],
  );
  return { total: f?.total ?? 0, pedidos: f?.pedidos ?? 0 };
}

export function panel(ctx: Contexto): DatosPanel {
  exigir(ctx, 'reportes.ver');
  const hoy = ctx.ahora();
  const manana = soloFecha(sumarDias(hoy, 1));
  const hace30 = soloFecha(sumarDias(hoy, -29));
  const hace60 = soloFecha(sumarDias(hoy, -59));

  const inv = ctx.db.get<{ costo: number | null; venta: number | null; unidades: number | null }>(
    'SELECT SUM(valor_costo) AS costo, SUM(valor_venta) AS venta, SUM(cantidad) AS unidades FROM v_valor_inventario',
  );
  const actual = ventasEntre(ctx, hace30, manana);
  const previas = ventasEntre(ctx, hace60, hace30);

  const diario = new Map(
    ctx.db
      .all<{ dia: string; total: number }>(
        `SELECT date(pe.fecha_confirmacion) AS dia, SUM(l.cantidad * l.precio_unitario) AS total
         FROM pedidos pe JOIN pedido_lineas l ON l.pedido_id = pe.id
         WHERE ${VENTA} AND pe.fecha_confirmacion >= ? AND pe.fecha_confirmacion < ?
         GROUP BY dia`,
        [hace30, manana],
      )
      .map((r) => [r.dia, r.total]),
  );
  const serieVentas: PuntoSerie[] = [];
  for (let i = 29; i >= 0; i--) {
    const dia = soloFecha(sumarDias(hoy, -i));
    serieVentas.push({ etiqueta: dia, valor: diario.get(dia) ?? 0 });
  }

  return {
    valorInventario: inv?.costo ?? 0,
    valorVentaPotencial: inv?.venta ?? 0,
    unidadesEnStock: inv?.unidades ?? 0,
    productosActivos: ctx.db.escalar('SELECT COUNT(*) FROM productos WHERE activo = 1'),
    stockBajo: ctx.db.escalar('SELECT COUNT(*) FROM v_stock_bajo'),
    pedidosPorConfirmar: ctx.db.escalar("SELECT COUNT(*) FROM pedidos WHERE estado = 'borrador'"),
    pedidosPorDespachar: ctx.db.escalar("SELECT COUNT(*) FROM pedidos WHERE estado = 'confirmado'"),
    ventas30: actual.total,
    ventasPrevias30: previas.total,
    pedidos30: actual.pedidos,
    ordenesAbiertas: ctx.db.escalar("SELECT COUNT(*) FROM ordenes_compra WHERE estado IN ('enviada', 'parcial')"),
    serieVentas,
    topProductos: ctx.db.all(
      `SELECT p.sku, p.nombre, SUM(l.cantidad) AS unidades, SUM(l.cantidad * l.precio_unitario) AS ingresos
       FROM pedidos pe JOIN pedido_lineas l ON l.pedido_id = pe.id JOIN productos p ON p.id = l.producto_id
       WHERE ${VENTA} AND pe.fecha_confirmacion >= ? AND pe.fecha_confirmacion < ?
       GROUP BY p.id ORDER BY ingresos DESC LIMIT 6`,
      [hace30, manana],
    ) as DatosPanel['topProductos'],
    alertas: ctx.db.all(
      'SELECT producto_id, sku, nombre, stock_total, stock_minimo FROM v_stock_bajo ORDER BY (stock_total * 1.0 / stock_minimo), sku LIMIT 6',
    ) as DatosPanel['alertas'],
    ultimosMovimientos: ctx.db.all(
      `SELECT id, fecha, tipo, sku, bodega, cantidad, nota FROM v_movimientos_detalle ORDER BY fecha DESC, id DESC LIMIT 8`,
    ) as DatosPanel['ultimosMovimientos'],
  };
}

export interface FilaStockBajo { producto_id: number; sku: string; nombre: string; categoria: string; stock_total: number; stock_minimo: number; faltante: number; proveedor: string | null }

export function stockBajo(ctx: Contexto): FilaStockBajo[] {
  exigir(ctx, 'reportes.ver');
  return ctx.db.all<FilaStockBajo>(
    `SELECT v.producto_id, v.sku, v.nombre, v.categoria, v.stock_total, v.stock_minimo, v.faltante, pr.nombre AS proveedor
     FROM v_stock_bajo v JOIN productos p ON p.id = v.producto_id LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
     ORDER BY v.faltante DESC, v.sku`,
  );
}

export interface FilaRotacion { producto_id: number; sku: string; nombre: string; vendidas: number; stock_actual: number; rotacion: number | null; cobertura_dias: number | null }

/** Rotación en el período: unidades vendidas netas (salidas menos anulaciones) sobre el stock actual. */
export function rotacion(ctx: Contexto, desde: string, hasta: string): FilaRotacion[] {
  exigir(ctx, 'reportes.ver');
  validarRango(desde, hasta);
  const dias = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1);
  const filas = ctx.db.all<{ producto_id: number; sku: string; nombre: string; vendidas: number; stock_actual: number }>(
    `SELECT s.producto_id, s.sku, s.nombre, s.stock_total AS stock_actual,
            COALESCE(-SUM(m.cantidad), 0) AS vendidas
     FROM v_stock_producto s
     LEFT JOIN movimientos m ON m.producto_id = s.producto_id AND m.referencia_tipo = 'pedido'
          AND m.fecha >= ? AND m.fecha < date(?, '+1 day')
     WHERE s.activo = 1
     GROUP BY s.producto_id
     ORDER BY vendidas DESC, s.sku`,
    [desde, hasta],
  );
  return filas.map((f) => ({
    ...f,
    rotacion: f.stock_actual > 0 ? Math.round((f.vendidas / f.stock_actual) * 100) / 100 : null,
    cobertura_dias: f.vendidas > 0 ? Math.round(f.stock_actual / (f.vendidas / dias)) : null,
  }));
}

export type Agrupacion = 'dia' | 'semana' | 'mes';

function validarRango(desde: string, hasta: string) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(desde) || !re.test(hasta)) throw new ErrorDominio('Las fechas deben tener el formato AAAA-MM-DD.');
  if (desde > hasta) throw new ErrorDominio('La fecha inicial no puede ser posterior a la final.');
}

export function ventasPorPeriodo(ctx: Contexto, desde: string, hasta: string, agrupar: Agrupacion): PuntoSerie[] {
  exigir(ctx, 'reportes.ver');
  validarRango(desde, hasta);
  const expresion = { dia: "date(pe.fecha_confirmacion)", semana: "strftime('%Y-S%W', pe.fecha_confirmacion)", mes: "strftime('%Y-%m', pe.fecha_confirmacion)" }[agrupar];
  return ctx.db.all<PuntoSerie>(
    `SELECT ${expresion} AS etiqueta, SUM(l.cantidad * l.precio_unitario) AS valor, COUNT(DISTINCT pe.id) AS extra
     FROM pedidos pe JOIN pedido_lineas l ON l.pedido_id = pe.id
     WHERE ${VENTA} AND pe.fecha_confirmacion >= ? AND pe.fecha_confirmacion < date(?, '+1 day')
     GROUP BY etiqueta ORDER BY etiqueta`,
    [desde, hasta],
  );
}

export interface FilaVentaProducto { sku: string; nombre: string; unidades: number; ingresos: number; margen: number }

export function ventasPorProducto(ctx: Contexto, desde: string, hasta: string): FilaVentaProducto[] {
  exigir(ctx, 'reportes.ver');
  validarRango(desde, hasta);
  return ctx.db.all<FilaVentaProducto>(
    `SELECT p.sku, p.nombre, SUM(l.cantidad) AS unidades, SUM(l.cantidad * l.precio_unitario) AS ingresos,
            SUM(l.cantidad * (l.precio_unitario - p.costo)) AS margen
     FROM pedidos pe JOIN pedido_lineas l ON l.pedido_id = pe.id JOIN productos p ON p.id = l.producto_id
     WHERE ${VENTA} AND pe.fecha_confirmacion >= ? AND pe.fecha_confirmacion < date(?, '+1 day')
     GROUP BY p.id ORDER BY ingresos DESC`,
    [desde, hasta],
  );
}

export interface FilaVentaCliente { nombre: string; documento: string; pedidos: number; ingresos: number }

export function ventasPorCliente(ctx: Contexto, desde: string, hasta: string): FilaVentaCliente[] {
  exigir(ctx, 'reportes.ver');
  validarRango(desde, hasta);
  return ctx.db.all<FilaVentaCliente>(
    `SELECT c.nombre, c.documento, COUNT(DISTINCT pe.id) AS pedidos, SUM(l.cantidad * l.precio_unitario) AS ingresos
     FROM pedidos pe JOIN clientes c ON c.id = pe.cliente_id JOIN pedido_lineas l ON l.pedido_id = pe.id
     WHERE ${VENTA} AND pe.fecha_confirmacion >= ? AND pe.fecha_confirmacion < date(?, '+1 day')
     GROUP BY c.id ORDER BY ingresos DESC`,
    [desde, hasta],
  );
}

export interface ValorInventario {
  total: number; totalVenta: number; unidades: number;
  porCategoria: { categoria: string; valor: number; unidades: number }[];
  porBodega: { bodega: string; valor: number; unidades: number }[];
}

export function valorInventario(ctx: Contexto): ValorInventario {
  exigir(ctx, 'reportes.ver');
  const t = ctx.db.get<{ costo: number | null; venta: number | null; unidades: number | null }>(
    'SELECT SUM(valor_costo) AS costo, SUM(valor_venta) AS venta, SUM(cantidad) AS unidades FROM v_valor_inventario',
  );
  return {
    total: t?.costo ?? 0,
    totalVenta: t?.venta ?? 0,
    unidades: t?.unidades ?? 0,
    porCategoria: ctx.db.all('SELECT categoria, SUM(valor_costo) AS valor, SUM(cantidad) AS unidades FROM v_valor_inventario GROUP BY categoria ORDER BY valor DESC') as ValorInventario['porCategoria'],
    porBodega: ctx.db.all('SELECT bodega, SUM(valor_costo) AS valor, SUM(cantidad) AS unidades FROM v_valor_inventario GROUP BY bodega ORDER BY bodega') as ValorInventario['porBodega'],
  };
}
