import { patronLike, tienePermiso, type Contexto } from './nucleo';

export type TipoResultado = 'producto' | 'cliente' | 'proveedor' | 'pedido' | 'orden';

export interface ResultadoBusqueda {
  tipo: TipoResultado;
  id: number;
  titulo: string;
  detalle: string;
  /** Ruta de la aplicación (sin «#/»). */
  ruta: string;
}

export const ETIQUETA_TIPO: Record<TipoResultado, string> = {
  producto: 'Productos',
  cliente: 'Clientes',
  proveedor: 'Proveedores',
  pedido: 'Pedidos',
  orden: 'Órdenes de compra',
};

const POR_GRUPO = 5;

/**
 * Búsqueda global sobre productos, clientes, proveedores, pedidos y órdenes de compra.
 * Solo devuelve lo que el rol puede ver; el SQL va siempre parametrizado.
 */
export function buscarGlobal(ctx: Contexto, consulta: string): ResultadoBusqueda[] {
  const q = consulta.trim();
  if (q.length < 2) return [];
  const like = patronLike(q);
  const rol = ctx.usuario.rol;
  const salida: ResultadoBusqueda[] = [];

  if (tienePermiso(rol, 'productos.ver')) {
    for (const p of ctx.db.all<{ id: number; sku: string; nombre: string; categoria: string }>(
      `SELECT p.id, p.sku, p.nombre, c.nombre AS categoria FROM productos p JOIN categorias c ON c.id = p.categoria_id
       WHERE p.sku LIKE ? ESCAPE '\\' OR p.nombre LIKE ? ESCAPE '\\' ORDER BY p.sku LIMIT ${POR_GRUPO}`,
      [like, like],
    )) salida.push({ tipo: 'producto', id: p.id, titulo: `${p.sku} · ${p.nombre}`, detalle: p.categoria, ruta: `productos?q=${encodeURIComponent(p.sku)}` });
  }
  if (tienePermiso(rol, 'clientes.ver')) {
    for (const c of ctx.db.all<{ id: number; nombre: string; documento: string; ciudad: string }>(
      `SELECT id, nombre, documento, ciudad FROM clientes
       WHERE nombre LIKE ? ESCAPE '\\' OR documento LIKE ? ESCAPE '\\' ORDER BY nombre LIMIT ${POR_GRUPO}`,
      [like, like],
    )) salida.push({ tipo: 'cliente', id: c.id, titulo: c.nombre, detalle: [c.documento, c.ciudad].filter(Boolean).join(' · '), ruta: `clientes?q=${encodeURIComponent(c.documento)}` });
  }
  if (tienePermiso(rol, 'proveedores.ver')) {
    for (const p of ctx.db.all<{ id: number; nombre: string; nit: string; ciudad: string }>(
      `SELECT id, nombre, nit, ciudad FROM proveedores
       WHERE nombre LIKE ? ESCAPE '\\' OR nit LIKE ? ESCAPE '\\' ORDER BY nombre LIMIT ${POR_GRUPO}`,
      [like, like],
    )) salida.push({ tipo: 'proveedor', id: p.id, titulo: p.nombre, detalle: [p.nit, p.ciudad].filter(Boolean).join(' · '), ruta: `proveedores?q=${encodeURIComponent(p.nit)}` });
  }
  if (tienePermiso(rol, 'pedidos.ver')) {
    for (const p of ctx.db.all<{ id: number; numero: string; cliente: string; estado: string }>(
      `SELECT p.id, p.numero, c.nombre AS cliente, p.estado FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.numero LIKE ? ESCAPE '\\' OR c.nombre LIKE ? ESCAPE '\\' ORDER BY p.id DESC LIMIT ${POR_GRUPO}`,
      [like, like],
    )) salida.push({ tipo: 'pedido', id: p.id, titulo: p.numero, detalle: `${p.cliente} · ${p.estado}`, ruta: `pedidos/${p.id}` });
  }
  if (tienePermiso(rol, 'compras.ver')) {
    for (const o of ctx.db.all<{ id: number; numero: string; proveedor: string; estado: string }>(
      `SELECT o.id, o.numero, p.nombre AS proveedor, o.estado FROM ordenes_compra o JOIN proveedores p ON p.id = o.proveedor_id
       WHERE o.numero LIKE ? ESCAPE '\\' OR p.nombre LIKE ? ESCAPE '\\' ORDER BY o.id DESC LIMIT ${POR_GRUPO}`,
      [like, like],
    )) salida.push({ tipo: 'orden', id: o.id, titulo: o.numero, detalle: `${o.proveedor} · ${o.estado}`, ruta: `compras/${o.id}` });
  }
  return salida;
}
