import { type Contexto, ErrorDominio, aTexto, entero, exigir, noEncontrado, operar, texto } from './nucleo';

export type EstadoPedido = 'borrador' | 'confirmado' | 'despachado' | 'anulado';

export const TRANSICIONES_PEDIDO: Record<EstadoPedido, EstadoPedido[]> = {
  borrador: ['confirmado', 'anulado'],
  confirmado: ['despachado', 'anulado'],
  despachado: [],
  anulado: [],
};

export interface PedidoResumen {
  id: number; numero: string; estado: EstadoPedido; fecha: string; cliente_id: number; cliente: string;
  bodega: string; usuario_id: number; vendedor: string; lineas: number; unidades: number; total: number;
}

export interface LineaPedido {
  id: number; producto_id: number; sku: string; nombre: string; unidad: string; cantidad: number;
  precio_unitario: number; subtotal: number; disponible: number;
}

export interface PedidoDetalle extends PedidoResumen {
  bodega_id: number; notas: string; fecha_confirmacion: string | null; fecha_despacho: string | null;
  fecha_anulacion: string | null; items: LineaPedido[];
}

export function listarPedidos(
  ctx: Contexto,
  f: { estado?: EstadoPedido | ''; q?: string; clienteId?: number | null } = {},
): PedidoResumen[] {
  exigir(ctx, 'pedidos.ver');
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.estado) {
    where.push('pe.estado = ?');
    params.push(f.estado);
  }
  if (f.clienteId) {
    where.push('pe.cliente_id = ?');
    params.push(f.clienteId);
  }
  if (f.q?.trim()) {
    where.push("(pe.numero LIKE ? ESCAPE '\\' OR c.nombre LIKE ? ESCAPE '\\')");
    const p = `%${f.q.trim().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    params.push(p, p);
  }
  return ctx.db.all<PedidoResumen>(
    `SELECT pe.id, pe.numero, pe.estado, pe.fecha, pe.cliente_id, c.nombre AS cliente, b.codigo AS bodega,
            pe.usuario_id, u.nombre AS vendedor, t.lineas, t.unidades, t.total
     FROM pedidos pe
     JOIN clientes c ON c.id = pe.cliente_id
     JOIN bodegas b ON b.id = pe.bodega_id
     JOIN usuarios u ON u.id = pe.usuario_id
     JOIN v_pedidos_totales t ON t.pedido_id = pe.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY pe.fecha DESC, pe.id DESC`,
    params,
  );
}

export function obtenerPedido(ctx: Contexto, id: number): PedidoDetalle {
  exigir(ctx, 'pedidos.ver');
  const base = ctx.db.get<Omit<PedidoDetalle, 'items'>>(
    `SELECT pe.id, pe.numero, pe.estado, pe.fecha, pe.cliente_id, c.nombre AS cliente, b.codigo AS bodega, pe.bodega_id,
            pe.usuario_id, u.nombre AS vendedor, t.lineas, t.unidades, t.total, pe.notas,
            pe.fecha_confirmacion, pe.fecha_despacho, pe.fecha_anulacion
     FROM pedidos pe
     JOIN clientes c ON c.id = pe.cliente_id
     JOIN bodegas b ON b.id = pe.bodega_id
     JOIN usuarios u ON u.id = pe.usuario_id
     JOIN v_pedidos_totales t ON t.pedido_id = pe.id
     WHERE pe.id = ?`,
    [id],
  );
  if (!base) noEncontrado('El pedido');
  const items = ctx.db.all<LineaPedido>(
    `SELECT l.id, l.producto_id, p.sku, p.nombre, p.unidad, l.cantidad, l.precio_unitario,
            l.cantidad * l.precio_unitario AS subtotal,
            COALESCE((SELECT e.cantidad FROM existencias e WHERE e.producto_id = l.producto_id AND e.bodega_id = ?), 0) AS disponible
     FROM pedido_lineas l JOIN productos p ON p.id = l.producto_id
     WHERE l.pedido_id = ? ORDER BY l.id`,
    [base.bodega_id, id],
  );
  return { ...base, items };
}

export interface DatosPedido {
  id?: number;
  clienteId: number;
  bodegaId: number;
  notas?: string;
  lineas: { productoId: number; cantidad: number | string; precioUnitario?: number | string }[];
}

function leerEstado(ctx: Contexto, id: number) {
  const p = ctx.db.get<{ estado: EstadoPedido; usuario_id: number; numero: string; bodega_id: number }>(
    'SELECT estado, usuario_id, numero, bodega_id FROM pedidos WHERE id = ?',
    [id],
  );
  if (!p) noEncontrado('El pedido');
  return p;
}

/** Un vendedor solo gestiona sus propios pedidos; el administrador gestiona todos. */
function exigirPropiedad(ctx: Contexto, usuarioPedido: number) {
  if (ctx.usuario.rol !== 'administrador' && ctx.usuario.id !== usuarioPedido) {
    throw new ErrorDominio('Solo puedes modificar los pedidos que tú creaste.', 'permiso');
  }
}

/** Crea o reemplaza un borrador (cabecera + líneas) en una sola transacción. */
export function guardarPedido(ctx: Contexto, d: DatosPedido): number {
  return operar(ctx, 'pedidos.crear', () => {
    const cliente = ctx.db.get<{ activo: number }>('SELECT activo FROM clientes WHERE id = ?', [d.clienteId]);
    if (!cliente) throw new ErrorDominio('Selecciona un cliente.');
    if (!cliente.activo) throw new ErrorDominio('El cliente está inactivo.', 'estado');
    const bodega = ctx.db.get<{ activa: number }>('SELECT activa FROM bodegas WHERE id = ?', [d.bodegaId]);
    if (!bodega?.activa) throw new ErrorDominio('Selecciona una bodega de despacho válida.');
    if (!d.lineas.length) throw new ErrorDominio('Agrega al menos un producto al pedido.');
    const notas = texto(d.notas ?? '', 'Las notas', { obligatorio: false, max: 300 });

    const vistos = new Set<number>();
    const lineas = d.lineas.map((l, i) => {
      if (vistos.has(l.productoId)) throw new ErrorDominio(`El producto de la línea ${i + 1} está repetido.`);
      vistos.add(l.productoId);
      const prod = ctx.db.get<{ sku: string; precio: number; activo: number }>('SELECT sku, precio, activo FROM productos WHERE id = ?', [l.productoId]);
      if (!prod) throw new ErrorDominio(`El producto de la línea ${i + 1} no existe.`);
      if (!prod.activo) throw new ErrorDominio(`El producto ${prod.sku} está inactivo.`, 'estado');
      const cantidad = entero(l.cantidad, `La cantidad de ${prod.sku}`, { min: 1, max: 100000 });
      const precio = l.precioUnitario === undefined || l.precioUnitario === '' ? prod.precio : entero(l.precioUnitario, `El precio de ${prod.sku}`, { min: 0 });
      return { productoId: l.productoId, cantidad, precio };
    });

    let id = d.id;
    if (id) {
      const actual = leerEstado(ctx, id);
      exigirPropiedad(ctx, actual.usuario_id);
      if (actual.estado !== 'borrador') throw new ErrorDominio('Solo se pueden editar pedidos en borrador.', 'estado');
      ctx.db.run('UPDATE pedidos SET cliente_id=?, bodega_id=?, notas=? WHERE id=?', [d.clienteId, d.bodegaId, notas, id]);
      ctx.db.run('DELETE FROM pedido_lineas WHERE pedido_id = ?', [id]);
    } else {
      const siguiente = ctx.db.escalar('SELECT COALESCE(MAX(id), 0) + 1 FROM pedidos');
      const numero = `PV-${String(siguiente).padStart(5, '0')}`;
      ctx.db.run(
        'INSERT INTO pedidos (numero, cliente_id, usuario_id, bodega_id, estado, fecha, notas) VALUES (?,?,?,?,?,?,?)',
        [numero, d.clienteId, ctx.usuario.id, d.bodegaId, 'borrador', aTexto(ctx.ahora()), notas],
      );
      id = ctx.db.ultimoId();
    }
    for (const l of lineas) {
      ctx.db.run('INSERT INTO pedido_lineas (pedido_id, producto_id, cantidad, precio_unitario) VALUES (?,?,?,?)', [id, l.productoId, l.cantidad, l.precio]);
    }
    return id;
  });
}

export function eliminarBorrador(ctx: Contexto, id: number): void {
  operar(ctx, 'pedidos.crear', () => {
    const p = leerEstado(ctx, id);
    exigirPropiedad(ctx, p.usuario_id);
    if (p.estado !== 'borrador') throw new ErrorDominio('Solo se pueden eliminar pedidos en borrador. Los demás se anulan.', 'estado');
    ctx.db.run('DELETE FROM pedidos WHERE id = ?', [id]);
  });
}

/** Faltantes de stock del pedido en su bodega (para avisar antes de confirmar). */
export function faltantesDeStock(ctx: Contexto, id: number): { sku: string; pedido: number; disponible: number }[] {
  const p = leerEstado(ctx, id);
  return ctx.db.all<{ sku: string; pedido: number; disponible: number }>(
    `SELECT pr.sku, l.cantidad AS pedido, COALESCE(e.cantidad, 0) AS disponible
     FROM pedido_lineas l
     JOIN productos pr ON pr.id = l.producto_id
     LEFT JOIN existencias e ON e.producto_id = l.producto_id AND e.bodega_id = ?
     WHERE l.pedido_id = ? AND COALESCE(e.cantidad, 0) < l.cantidad
     ORDER BY pr.sku`,
    [p.bodega_id, id],
  );
}

function cambiarEstado(ctx: Contexto, id: number, destino: EstadoPedido) {
  const p = leerEstado(ctx, id);
  if (!TRANSICIONES_PEDIDO[p.estado].includes(destino)) {
    throw new ErrorDominio(`Un pedido ${p.estado} no puede pasar a ${destino}.`, 'estado');
  }
  const ahora = aTexto(ctx.ahora());
  const columna = { confirmado: 'fecha_confirmacion', despachado: 'fecha_despacho', anulado: 'fecha_anulacion', borrador: '' }[destino];
  ctx.db.run(`UPDATE pedidos SET estado = ?, ${columna} = ? WHERE id = ?`, [destino, ahora, id]);
  return p;
}

export function confirmarPedido(ctx: Contexto, id: number): void {
  operar(ctx, 'pedidos.confirmar', () => {
    const p = leerEstado(ctx, id);
    exigirPropiedad(ctx, p.usuario_id);
    if (p.estado === 'borrador') {
      const faltan = faltantesDeStock(ctx, id);
      if (faltan.length) {
        throw new ErrorDominio(
          'No hay stock suficiente para confirmar el pedido. No se descontó nada.',
          'stock',
          faltan.map((f) => `${f.sku}: se piden ${f.pedido} y hay ${f.disponible}`),
        );
      }
    }
    cambiarEstado(ctx, id, 'confirmado');
  });
}

export function despacharPedido(ctx: Contexto, id: number): void {
  operar(ctx, 'pedidos.despachar', () => {
    cambiarEstado(ctx, id, 'despachado');
  });
}

export function anularPedido(ctx: Contexto, id: number): void {
  operar(ctx, 'pedidos.anular', () => {
    const p = leerEstado(ctx, id);
    exigirPropiedad(ctx, p.usuario_id);
    cambiarEstado(ctx, id, 'anulado');
  });
}
