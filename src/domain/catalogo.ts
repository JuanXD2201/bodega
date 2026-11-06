import { type Contexto, ErrorDominio, entero, noEncontrado, operar, patronLike, texto, aTexto, exigir } from './nucleo';
import { escribirCsv, leerCsv } from './csv';

export interface Categoria { id: number; nombre: string; descripcion: string }
export interface Bodega { id: number; codigo: string; nombre: string; ciudad: string; activa: number }
export interface ProductoFila {
  id: number; sku: string; nombre: string; descripcion: string; categoria_id: number; categoria: string;
  proveedor_id: number | null; proveedor: string | null; unidad: string; costo: number; precio: number;
  stock_minimo: number; activo: number; stock_total: number;
}

export interface FiltrosProductos {
  q?: string;
  categoriaId?: number | null;
  estado?: 'todos' | 'activos' | 'inactivos' | 'bajo';
  orden?: 'sku' | 'nombre' | 'precio' | 'stock';
  descendente?: boolean;
}

export function listarCategorias(ctx: Contexto): Categoria[] {
  exigir(ctx, 'productos.ver');
  return ctx.db.all<Categoria>('SELECT id, nombre, descripcion FROM categorias ORDER BY nombre');
}

export function listarBodegas(ctx: Contexto): Bodega[] {
  return ctx.db.all<Bodega>('SELECT id, codigo, nombre, ciudad, activa FROM bodegas ORDER BY id');
}

const COLUMNAS_ORDEN = { sku: 'p.sku', nombre: 'p.nombre COLLATE NOCASE', precio: 'p.precio', stock: 's.stock_total' } as const;

export function listarProductos(ctx: Contexto, f: FiltrosProductos = {}): ProductoFila[] {
  exigir(ctx, 'productos.ver');
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q?.trim()) {
    where.push("(p.sku LIKE ? ESCAPE '\\' OR p.nombre LIKE ? ESCAPE '\\')");
    params.push(patronLike(f.q), patronLike(f.q));
  }
  if (f.categoriaId) {
    where.push('p.categoria_id = ?');
    params.push(f.categoriaId);
  }
  if (f.estado === 'activos') where.push('p.activo = 1');
  if (f.estado === 'inactivos') where.push('p.activo = 0');
  if (f.estado === 'bajo') where.push('p.activo = 1 AND s.stock_total < p.stock_minimo');
  const orden = COLUMNAS_ORDEN[f.orden ?? 'sku'];
  return ctx.db.all<ProductoFila>(
    `SELECT p.id, p.sku, p.nombre, p.descripcion, p.categoria_id, c.nombre AS categoria,
            p.proveedor_id, pr.nombre AS proveedor, p.unidad, p.costo, p.precio, p.stock_minimo, p.activo,
            s.stock_total
     FROM productos p
     JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
     JOIN v_stock_producto s ON s.producto_id = p.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${orden} ${f.descendente ? 'DESC' : 'ASC'}, p.id`,
    params,
  );
}

export function obtenerProducto(ctx: Contexto, id: number): ProductoFila {
  exigir(ctx, 'productos.ver');
  const fila = listarProductos(ctx).find((p) => p.id === id);
  return fila ?? noEncontrado('El producto');
}

export interface DatosProducto {
  id?: number;
  sku: string;
  nombre: string;
  descripcion?: string;
  categoriaId: number;
  proveedorId?: number | null;
  unidad?: string;
  costo: number | string;
  precio: number | string;
  stockMinimo: number | string;
  activo?: boolean;
}

const SKU_VALIDO = /^[A-Z0-9-]{3,20}$/;

function validarProducto(d: DatosProducto) {
  const sku = texto(d.sku, 'El SKU', { max: 20 }).toUpperCase();
  if (!SKU_VALIDO.test(sku)) throw new ErrorDominio('El SKU solo admite letras, números y guiones (3 a 20 caracteres).');
  const costo = entero(d.costo, 'El costo');
  const precio = entero(d.precio, 'El precio', { min: 1 });
  if (precio < costo) throw new ErrorDominio('El precio de venta no puede ser menor al costo.');
  return {
    sku,
    nombre: texto(d.nombre, 'El nombre', { max: 120 }),
    descripcion: texto(d.descripcion ?? '', 'La descripción', { obligatorio: false, max: 400 }),
    unidad: texto(d.unidad ?? 'und', 'La unidad', { max: 12 }),
    costo,
    precio,
    stockMinimo: entero(d.stockMinimo, 'El stock mínimo'),
  };
}

export function guardarProducto(ctx: Contexto, d: DatosProducto): number {
  return operar(ctx, 'productos.editar', () => {
    const v = validarProducto(d);
    const cat = ctx.db.get('SELECT id FROM categorias WHERE id = ?', [d.categoriaId]);
    if (!cat) throw new ErrorDominio('Selecciona una categoría válida.');
    const activo = d.activo === false ? 0 : 1;
    if (d.id) {
      if (!ctx.db.get('SELECT id FROM productos WHERE id = ?', [d.id])) noEncontrado('El producto');
      ctx.db.run(
        `UPDATE productos SET sku=?, nombre=?, descripcion=?, categoria_id=?, proveedor_id=?, unidad=?,
                costo=?, precio=?, stock_minimo=?, activo=? WHERE id=?`,
        [v.sku, v.nombre, v.descripcion, d.categoriaId, d.proveedorId ?? null, v.unidad, v.costo, v.precio, v.stockMinimo, activo, d.id],
      );
      return d.id;
    }
    ctx.db.run(
      `INSERT INTO productos (sku, nombre, descripcion, categoria_id, proveedor_id, unidad, costo, precio, stock_minimo, activo, creado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [v.sku, v.nombre, v.descripcion, d.categoriaId, d.proveedorId ?? null, v.unidad, v.costo, v.precio, v.stockMinimo, activo, aTexto(ctx.ahora())],
    );
    return ctx.db.ultimoId();
  });
}

/** Elimina si no hay historial; si lo hay, lo desactiva para conservar la trazabilidad. */
export function eliminarProducto(ctx: Contexto, id: number): 'eliminado' | 'desactivado' {
  return operar(ctx, 'productos.editar', () => {
    if (!ctx.db.get('SELECT id FROM productos WHERE id = ?', [id])) noEncontrado('El producto');
    const usos =
      ctx.db.escalar('SELECT COUNT(*) FROM movimientos WHERE producto_id = ?', [id]) +
      ctx.db.escalar('SELECT COUNT(*) FROM pedido_lineas WHERE producto_id = ?', [id]) +
      ctx.db.escalar('SELECT COUNT(*) FROM compra_lineas WHERE producto_id = ?', [id]);
    if (usos > 0) {
      ctx.db.run('UPDATE productos SET activo = 0 WHERE id = ?', [id]);
      return 'desactivado';
    }
    ctx.db.run('DELETE FROM existencias WHERE producto_id = ?', [id]);
    ctx.db.run('DELETE FROM productos WHERE id = ?', [id]);
    return 'eliminado';
  });
}

// ------------------------------------------------------------------- CSV

const ENCABEZADO_CSV = ['sku', 'nombre', 'categoria', 'proveedor', 'unidad', 'costo', 'precio', 'stock_minimo', 'activo'];

export function exportarProductosCsv(ctx: Contexto): string {
  const filas = listarProductos(ctx).map((p) => [
    p.sku, p.nombre, p.categoria, p.proveedor ?? '', p.unidad, p.costo, p.precio, p.stock_minimo, p.activo ? 'si' : 'no',
  ]);
  return escribirCsv(ENCABEZADO_CSV, filas);
}

export interface ResultadoImportacion { creados: number; actualizados: number }

/**
 * Importa productos desde CSV (clave: sku). Todo o nada: si una fila falla se
 * informan todos los errores con su número de fila y no se guarda nada.
 */
export function importarProductosCsv(ctx: Contexto, contenido: string): ResultadoImportacion {
  exigir(ctx, 'productos.editar');
  const filas = leerCsv(contenido);
  const [cabecera, ...datos] = filas as [string[], ...string[][]];
  const idx = Object.fromEntries(cabecera.map((c, i) => [c.trim().toLowerCase(), i]));
  const faltan = ['sku', 'nombre', 'categoria', 'costo', 'precio'].filter((c) => idx[c] === undefined);
  if (faltan.length) throw new ErrorDominio(`Faltan columnas obligatorias: ${faltan.join(', ')}.`);
  if (!datos.length) throw new ErrorDominio('El archivo solo tiene encabezado, no hay productos para importar.');
  if (datos.length > 2000) throw new ErrorDominio('Se admiten hasta 2000 filas por importación.');

  const col = (fila: string[], nombre: string) => (idx[nombre] === undefined ? '' : (fila[idx[nombre]!] ?? '').trim());
  const errores: string[] = [];
  let creados = 0;
  let actualizados = 0;

  try {
    ctx.db.transaccion(() => {
      datos.forEach((fila, i) => {
        const n = i + 2;
        // Punto de guardado por fila: un error no deja medio escrita ninguna fila.
        try {
          ctx.db.transaccion(() => {
            const categoriaNombre = texto(col(fila, 'categoria'), 'La categoría', { max: 60 });
            let cat = ctx.db.get<{ id: number }>('SELECT id FROM categorias WHERE nombre = ? COLLATE NOCASE', [categoriaNombre]);
            if (!cat) {
              ctx.db.run('INSERT INTO categorias (nombre) VALUES (?)', [categoriaNombre]);
              cat = { id: ctx.db.ultimoId() };
            }
            const provNombre = col(fila, 'proveedor');
            let proveedorId: number | null = null;
            if (provNombre) {
              const pr = ctx.db.get<{ id: number }>('SELECT id FROM proveedores WHERE nombre = ? COLLATE NOCASE', [provNombre]);
              if (!pr) throw new ErrorDominio(`El proveedor «${provNombre}» no existe.`);
              proveedorId = pr.id;
            }
            const datosFila: DatosProducto = {
              sku: col(fila, 'sku'),
              nombre: col(fila, 'nombre'),
              categoriaId: cat.id,
              proveedorId,
              unidad: col(fila, 'unidad') || 'und',
              costo: col(fila, 'costo'),
              precio: col(fila, 'precio'),
              stockMinimo: col(fila, 'stock_minimo') || '0',
              activo: !['no', '0', 'false'].includes(col(fila, 'activo').toLowerCase()),
            };
            const v = validarProducto(datosFila);
            const existente = ctx.db.get<{ id: number }>('SELECT id FROM productos WHERE sku = ?', [v.sku]);
            if (existente) {
              guardarProducto(ctx, { ...datosFila, id: existente.id });
              actualizados++;
            } else {
              guardarProducto(ctx, datosFila);
              creados++;
            }
          });
        } catch (e) {
          errores.push(`Fila ${n}: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      if (errores.length) throw new ErrorDominio('No se importó nada: hay filas con errores.', 'validacion', errores);
    });
  } catch (e) {
    if (e instanceof ErrorDominio) throw e;
    throw new ErrorDominio(e instanceof Error ? e.message : String(e), 'sql');
  }
  return { creados, actualizados };
}
