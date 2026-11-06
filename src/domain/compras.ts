import { type Contexto, ErrorDominio, aTexto, entero, exigir, noEncontrado, operar, texto } from './nucleo';

export type EstadoOrden = 'borrador' | 'enviada' | 'parcial' | 'recibida' | 'anulada';

export interface OrdenResumen {
  id: number; numero: string; estado: EstadoOrden; fecha: string; proveedor_id: number; proveedor: string;
  bodega: string; lineas: number; unidades_pedidas: number; unidades_recibidas: number; total: number;
}

export interface LineaOrden {
  id: number; producto_id: number; sku: string; nombre: string; cantidad_pedida: number;
  cantidad_recibida: number; pendiente: number; costo_unitario: number; subtotal: number;
}

export interface OrdenDetalle extends OrdenResumen {
  bodega_id: number; notas: string; items: LineaOrden[];
}

export function listarOrdenes(ctx: Contexto, f: { estado?: EstadoOrden | ''; q?: string } = {}): OrdenResumen[] {
  exigir(ctx, 'compras.ver');
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.estado) {
    where.push('o.estado = ?');
    params.push(f.estado);
  }
  if (f.q?.trim()) {
    where.push("(o.numero LIKE ? ESCAPE '\\' OR p.nombre LIKE ? ESCAPE '\\')");
    const l = `%${f.q.trim().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    params.push(l, l);
  }
  return ctx.db.all<OrdenResumen>(
    `SELECT o.id, o.numero, o.estado, o.fecha, o.proveedor_id, p.nombre AS proveedor, b.codigo AS bodega,
            t.lineas, t.unidades_pedidas, t.unidades_recibidas, t.total
     FROM ordenes_compra o
     JOIN proveedores p ON p.id = o.proveedor_id
     JOIN bodegas b ON b.id = o.bodega_id
     JOIN v_ordenes_totales t ON t.orden_id = o.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY o.fecha DESC, o.id DESC`,
    params,
  );
}

export function obtenerOrden(ctx: Contexto, id: number): OrdenDetalle {
  exigir(ctx, 'compras.ver');
  const base = ctx.db.get<Omit<OrdenDetalle, 'items'>>(
    `SELECT o.id, o.numero, o.estado, o.fecha, o.proveedor_id, p.nombre AS proveedor, b.codigo AS bodega, o.bodega_id,
            o.notas, t.lineas, t.unidades_pedidas, t.unidades_recibidas, t.total
     FROM ordenes_compra o
     JOIN proveedores p ON p.id = o.proveedor_id
     JOIN bodegas b ON b.id = o.bodega_id
     JOIN v_ordenes_totales t ON t.orden_id = o.id
     WHERE o.id = ?`,
    [id],
  );
  if (!base) noEncontrado('La orden de compra');
  const items = ctx.db.all<LineaOrden>(
    `SELECT l.id, l.producto_id, p.sku, p.nombre, l.cantidad_pedida, l.cantidad_recibida,
            l.cantidad_pedida - l.cantidad_recibida AS pendiente, l.costo_unitario,
            l.cantidad_pedida * l.costo_unitario AS subtotal
     FROM compra_lineas l JOIN productos p ON p.id = l.producto_id
     WHERE l.orden_id = ? ORDER BY l.id`,
    [id],
  );
  return { ...base, items };
}

export interface DatosOrden {
  id?: number;
  proveedorId: number;
  bodegaId: number;
  notas?: string;
  lineas: { productoId: number; cantidad: number | string; costoUnitario?: number | string }[];
}

function estadoOrden(ctx: Contexto, id: number): EstadoOrden {
  const o = ctx.db.get<{ estado: EstadoOrden }>('SELECT estado FROM ordenes_compra WHERE id = ?', [id]);
  if (!o) noEncontrado('La orden de compra');
  return o.estado;
}

export function guardarOrden(ctx: Contexto, d: DatosOrden): number {
  return operar(ctx, 'compras.gestionar', () => {
    const prov = ctx.db.get<{ activo: number }>('SELECT activo FROM proveedores WHERE id = ?', [d.proveedorId]);
    if (!prov) throw new ErrorDominio('Selecciona un proveedor.');
    if (!prov.activo) throw new ErrorDominio('El proveedor está inactivo.', 'estado');
    if (!ctx.db.get('SELECT id FROM bodegas WHERE id = ? AND activa = 1', [d.bodegaId])) throw new ErrorDominio('Selecciona la bodega de recepción.');
    if (!d.lineas.length) throw new ErrorDominio('Agrega al menos un producto a la orden.');
    const notas = texto(d.notas ?? '', 'Las notas', { obligatorio: false, max: 300 });

    const vistos = new Set<number>();
    const lineas = d.lineas.map((l, i) => {
      if (vistos.has(l.productoId)) throw new ErrorDominio(`El producto de la línea ${i + 1} está repetido.`);
      vistos.add(l.productoId);
      const prod = ctx.db.get<{ sku: string; costo: number; activo: number }>('SELECT sku, costo, activo FROM productos WHERE id = ?', [l.productoId]);
      if (!prod) throw new ErrorDominio(`El producto de la línea ${i + 1} no existe.`);
      if (!prod.activo) throw new ErrorDominio(`El producto ${prod.sku} está inactivo.`, 'estado');
      return {
        productoId: l.productoId,
        cantidad: entero(l.cantidad, `La cantidad de ${prod.sku}`, { min: 1, max: 100000 }),
        costo: l.costoUnitario === undefined || l.costoUnitario === '' ? prod.costo : entero(l.costoUnitario, `El costo de ${prod.sku}`),
      };
    });

    let id = d.id;
    if (id) {
      if (estadoOrden(ctx, id) !== 'borrador') throw new ErrorDominio('Solo se pueden editar órdenes en borrador.', 'estado');
      ctx.db.run('UPDATE ordenes_compra SET proveedor_id=?, bodega_id=?, notas=? WHERE id=?', [d.proveedorId, d.bodegaId, notas, id]);
      ctx.db.run('DELETE FROM compra_lineas WHERE orden_id = ?', [id]);
    } else {
      const siguiente = ctx.db.escalar('SELECT COALESCE(MAX(id), 0) + 1 FROM ordenes_compra');
      ctx.db.run(
        'INSERT INTO ordenes_compra (numero, proveedor_id, bodega_id, usuario_id, estado, fecha, notas) VALUES (?,?,?,?,?,?,?)',
        [`OC-${String(siguiente).padStart(5, '0')}`, d.proveedorId, d.bodegaId, ctx.usuario.id, 'borrador', aTexto(ctx.ahora()), notas],
      );
      id = ctx.db.ultimoId();
    }
    for (const l of lineas) {
      ctx.db.run('INSERT INTO compra_lineas (orden_id, producto_id, cantidad_pedida, costo_unitario) VALUES (?,?,?,?)', [id, l.productoId, l.cantidad, l.costo]);
    }
    return id;
  });
}

export function eliminarOrdenBorrador(ctx: Contexto, id: number): void {
  operar(ctx, 'compras.gestionar', () => {
    if (estadoOrden(ctx, id) !== 'borrador') throw new ErrorDominio('Solo se pueden eliminar órdenes en borrador.', 'estado');
    ctx.db.run('DELETE FROM ordenes_compra WHERE id = ?', [id]);
  });
}

export function enviarOrden(ctx: Contexto, id: number): void {
  operar(ctx, 'compras.gestionar', () => {
    if (estadoOrden(ctx, id) !== 'borrador') throw new ErrorDominio('Solo se pueden enviar órdenes en borrador.', 'estado');
    ctx.db.run("UPDATE ordenes_compra SET estado = 'enviada' WHERE id = ?", [id]);
  });
}

export function anularOrden(ctx: Contexto, id: number): void {
  operar(ctx, 'compras.gestionar', () => {
    const e = estadoOrden(ctx, id);
    if (e === 'parcial' || e === 'recibida' || e === 'anulada') {
      throw new ErrorDominio(`Una orden ${e} no se puede anular.`, 'estado');
    }
    ctx.db.run("UPDATE ordenes_compra SET estado = 'anulada' WHERE id = ?", [id]);
  });
}

/**
 * Registra una recepción (parcial o total). Cada línea con cantidad > 0
 * genera una recepción; el trigger actualiza stock, movimientos y estado.
 */
export function recibirOrden(ctx: Contexto, id: number, recibidos: { lineaId: number; cantidad: number | string }[]): void {
  operar(ctx, 'compras.recibir', () => {
    const estado = estadoOrden(ctx, id);
    if (estado !== 'enviada' && estado !== 'parcial') {
      throw new ErrorDominio(`Una orden ${estado} no admite recepciones.`, 'estado');
    }
    const validas = recibidos
      .map((r) => ({ lineaId: r.lineaId, cantidad: entero(r.cantidad === '' ? 0 : r.cantidad, 'La cantidad recibida') }))
      .filter((r) => r.cantidad > 0);
    if (!validas.length) throw new ErrorDominio('Indica la cantidad recibida de al menos una línea.');
    const ahora = aTexto(ctx.ahora());
    for (const r of validas) {
      const linea = ctx.db.get<{ orden_id: number; sku: string; pendiente: number }>(
        `SELECT l.orden_id, p.sku, l.cantidad_pedida - l.cantidad_recibida AS pendiente
         FROM compra_lineas l JOIN productos p ON p.id = l.producto_id WHERE l.id = ?`,
        [r.lineaId],
      );
      if (!linea || linea.orden_id !== id) throw new ErrorDominio('Una de las líneas no pertenece a esta orden.');
      if (r.cantidad > linea.pendiente) {
        throw new ErrorDominio(`${linea.sku}: se recibieron ${r.cantidad} pero solo faltan ${linea.pendiente}.`);
      }
      ctx.db.run('INSERT INTO recepciones (linea_id, cantidad, fecha, usuario_id) VALUES (?,?,?,?)', [r.lineaId, r.cantidad, ahora, ctx.usuario.id]);
    }
  });
}
