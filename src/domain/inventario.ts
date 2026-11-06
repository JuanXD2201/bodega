import { type Contexto, ErrorDominio, aTexto, entero, exigir, noEncontrado, operar, patronLike, texto } from './nucleo';

export interface FilaExistencia {
  producto_id: number; sku: string; nombre: string; categoria: string; stock_minimo: number; activo: number;
  stock_total: number; por_bodega: Record<string, number>;
}

/** Matriz producto × bodega con el total por producto. */
export function matrizExistencias(
  ctx: Contexto,
  filtros: { q?: string; soloBajo?: boolean } = {},
): { bodegas: { id: number; codigo: string; nombre: string }[]; filas: FilaExistencia[] } {
  exigir(ctx, 'existencias.ver');
  const bodegas = ctx.db.all<{ id: number; codigo: string; nombre: string }>('SELECT id, codigo, nombre FROM bodegas WHERE activa = 1 ORDER BY id');
  const productos = ctx.db.all<Omit<FilaExistencia, 'por_bodega'> & { categoria: string }>(
    `SELECT s.producto_id, s.sku, s.nombre, c.nombre AS categoria, s.stock_minimo, s.activo, s.stock_total
     FROM v_stock_producto s JOIN categorias c ON c.id = s.categoria_id
     WHERE s.activo = 1 AND (? = '' OR s.sku LIKE ? ESCAPE '\\' OR s.nombre LIKE ? ESCAPE '\\')
     ORDER BY s.sku`,
    [(filtros.q ?? '').trim(), patronLike(filtros.q ?? ''), patronLike(filtros.q ?? '')],
  );
  const mapa = new Map<number, Record<string, number>>();
  for (const e of ctx.db.all<{ producto_id: number; codigo: string; cantidad: number }>(
    'SELECT e.producto_id, b.codigo, e.cantidad FROM existencias e JOIN bodegas b ON b.id = e.bodega_id',
  )) {
    const m = mapa.get(e.producto_id) ?? {};
    m[e.codigo] = e.cantidad;
    mapa.set(e.producto_id, m);
  }
  let filas = productos.map((p) => ({ ...p, por_bodega: mapa.get(p.producto_id) ?? {} }));
  if (filtros.soloBajo) filas = filas.filter((f) => f.stock_total < f.stock_minimo);
  return { bodegas, filas };
}

export function stockEn(ctx: Contexto, productoId: number, bodegaId: number): number {
  return ctx.db.escalar('SELECT COALESCE((SELECT cantidad FROM existencias WHERE producto_id = ? AND bodega_id = ?), 0)', [productoId, bodegaId]);
}

function verificarProductoBodega(ctx: Contexto, productoId: number, bodegaId: number) {
  const p = ctx.db.get<{ sku: string; activo: number }>('SELECT sku, activo FROM productos WHERE id = ?', [productoId]);
  if (!p) noEncontrado('El producto');
  if (!p.activo) throw new ErrorDominio(`El producto ${p.sku} está inactivo.`, 'estado');
  const b = ctx.db.get<{ activa: number }>('SELECT activa FROM bodegas WHERE id = ?', [bodegaId]);
  if (!b) noEncontrado('La bodega');
  if (!b.activa) throw new ErrorDominio('La bodega está inactiva.', 'estado');
  return p;
}

export const MOTIVOS_AJUSTE = ['conteo', 'merma', 'daño', 'corrección'] as const;
export type MotivoAjuste = (typeof MOTIVOS_AJUSTE)[number];

export function ajustarStock(
  ctx: Contexto,
  d: { productoId: number; bodegaId: number; cantidad: number | string; motivo: string; nota?: string },
): number {
  return operar(ctx, 'existencias.ajustar', () => {
    const cantidad = entero(d.cantidad, 'La cantidad', { min: -1_000_000 });
    if (cantidad === 0) throw new ErrorDominio('La cantidad del ajuste no puede ser cero.');
    if (!(MOTIVOS_AJUSTE as readonly string[]).includes(d.motivo)) throw new ErrorDominio('Selecciona un motivo de ajuste válido.');
    const p = verificarProductoBodega(ctx, d.productoId, d.bodegaId);
    const actual = stockEn(ctx, d.productoId, d.bodegaId);
    if (actual + cantidad < 0) {
      throw new ErrorDominio(`Stock insuficiente para ${p.sku}: hay ${actual} y el ajuste resta ${-cantidad}.`, 'stock');
    }
    ctx.db.run(
      'INSERT INTO ajustes (producto_id, bodega_id, cantidad, motivo, fecha, usuario_id, nota) VALUES (?,?,?,?,?,?,?)',
      [d.productoId, d.bodegaId, cantidad, d.motivo, aTexto(ctx.ahora()), ctx.usuario.id, texto(d.nota ?? '', 'La nota', { obligatorio: false, max: 200 })],
    );
    return ctx.db.ultimoId();
  });
}

export function trasladarStock(
  ctx: Contexto,
  d: { productoId: number; origenId: number; destinoId: number; cantidad: number | string; nota?: string },
): number {
  return operar(ctx, 'existencias.trasladar', () => {
    const cantidad = entero(d.cantidad, 'La cantidad', { min: 1 });
    if (d.origenId === d.destinoId) throw new ErrorDominio('La bodega de origen y la de destino deben ser distintas.');
    const p = verificarProductoBodega(ctx, d.productoId, d.origenId);
    verificarProductoBodega(ctx, d.productoId, d.destinoId);
    const actual = stockEn(ctx, d.productoId, d.origenId);
    if (actual < cantidad) {
      throw new ErrorDominio(`Stock insuficiente para ${p.sku} en la bodega de origen: hay ${actual} y se piden ${cantidad}.`, 'stock');
    }
    ctx.db.run(
      'INSERT INTO traslados (producto_id, origen_id, destino_id, cantidad, fecha, usuario_id, nota) VALUES (?,?,?,?,?,?,?)',
      [d.productoId, d.origenId, d.destinoId, cantidad, aTexto(ctx.ahora()), ctx.usuario.id, texto(d.nota ?? '', 'La nota', { obligatorio: false, max: 200 })],
    );
    return ctx.db.ultimoId();
  });
}

// --------------------------------------------------------------- auditoría

export interface FiltrosMovimientos {
  q?: string;
  tipo?: string;
  bodegaId?: number | null;
  desde?: string;
  hasta?: string;
  pagina?: number;
  porPagina?: number;
}

export interface MovimientoFila {
  id: number; fecha: string; tipo: string; sku: string; producto: string; bodega: string; cantidad: number;
  referencia_tipo: string; referencia_id: number; usuario: string; nota: string;
}

export function listarMovimientos(ctx: Contexto, f: FiltrosMovimientos = {}): { filas: MovimientoFila[]; total: number } {
  exigir(ctx, 'auditoria.ver');
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q?.trim()) {
    where.push("(sku LIKE ? ESCAPE '\\' OR producto LIKE ? ESCAPE '\\' OR nota LIKE ? ESCAPE '\\' OR usuario LIKE ? ESCAPE '\\')");
    const p = patronLike(f.q);
    params.push(p, p, p, p);
  }
  if (f.tipo) {
    where.push('tipo = ?');
    params.push(f.tipo);
  }
  if (f.bodegaId) {
    where.push('bodega = (SELECT codigo FROM bodegas WHERE id = ?)');
    params.push(f.bodegaId);
  }
  if (f.desde) {
    where.push('fecha >= ?');
    params.push(f.desde);
  }
  if (f.hasta) {
    where.push('fecha < date(?, \'+1 day\')');
    params.push(f.hasta);
  }
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const porPagina = Math.min(Math.max(f.porPagina ?? 50, 1), 500);
  const offset = Math.max((f.pagina ?? 1) - 1, 0) * porPagina;
  const total = ctx.db.escalar(`SELECT COUNT(*) FROM v_movimientos_detalle ${cond}`, params);
  const filas = ctx.db.all<MovimientoFila>(
    `SELECT * FROM v_movimientos_detalle ${cond} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, porPagina, offset],
  );
  return { filas, total };
}
