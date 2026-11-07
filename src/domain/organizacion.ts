import { ErrorDominio, noEncontrado, operar, texto, type Contexto } from './nucleo';

export interface CategoriaOrg { id: number; nombre: string; descripcion: string; productos: number }
export interface BodegaOrg { id: number; codigo: string; nombre: string; ciudad: string; activa: boolean; unidades: number }

export function listarCategoriasOrg(ctx: Contexto): CategoriaOrg[] {
  return ctx.db.all<CategoriaOrg>(
    `SELECT c.id, c.nombre, c.descripcion, (SELECT COUNT(*) FROM productos p WHERE p.categoria_id = c.id) AS productos
     FROM categorias c ORDER BY c.nombre`,
  );
}

export function guardarCategoria(ctx: Contexto, d: { id?: number; nombre: string; descripcion?: string }): number {
  return operar(ctx, 'productos.editar', () => {
    const nombre = texto(d.nombre, 'El nombre', { max: 60 });
    const descripcion = texto(d.descripcion ?? '', 'La descripción', { obligatorio: false, max: 200 });
    const repetida = ctx.db.get('SELECT id FROM categorias WHERE nombre = ? COLLATE NOCASE AND id <> ?', [nombre, d.id ?? -1]);
    if (repetida) throw new ErrorDominio('Ya existe una categoría con ese nombre.', 'conflicto');
    if (d.id) {
      if (!ctx.db.get('SELECT id FROM categorias WHERE id = ?', [d.id])) noEncontrado('La categoría');
      ctx.db.run('UPDATE categorias SET nombre = ?, descripcion = ? WHERE id = ?', [nombre, descripcion, d.id]);
      return d.id;
    }
    ctx.db.run('INSERT INTO categorias (nombre, descripcion) VALUES (?,?)', [nombre, descripcion]);
    return ctx.db.ultimoId();
  });
}

export function eliminarCategoria(ctx: Contexto, id: number): void {
  operar(ctx, 'productos.editar', () => {
    const usos = ctx.db.escalar('SELECT COUNT(*) FROM productos WHERE categoria_id = ?', [id]);
    if (usos > 0) throw new ErrorDominio(`La categoría tiene ${usos} ${usos === 1 ? 'producto' : 'productos'}. Muévelos a otra categoría antes de eliminarla.`, 'conflicto');
    ctx.db.run('DELETE FROM categorias WHERE id = ?', [id]);
  });
}

export function listarBodegasOrg(ctx: Contexto): BodegaOrg[] {
  return ctx.db
    .all<{ id: number; codigo: string; nombre: string; ciudad: string; activa: number; unidades: number }>(
      `SELECT b.id, b.codigo, b.nombre, b.ciudad, b.activa,
              COALESCE((SELECT SUM(e.cantidad) FROM existencias e WHERE e.bodega_id = b.id), 0) AS unidades
       FROM bodegas b ORDER BY b.id`,
    )
    .map((b) => ({ ...b, activa: b.activa === 1 }));
}

export function guardarBodega(ctx: Contexto, d: { id?: number; codigo: string; nombre: string; ciudad?: string; activa?: boolean }): number {
  return operar(ctx, 'bd.administrar', () => {
    const codigo = texto(d.codigo, 'El código', { max: 10 }).toUpperCase();
    if (codigo.length < 2) throw new ErrorDominio('El código debe tener entre 2 y 10 caracteres.');
    const nombre = texto(d.nombre, 'El nombre', { max: 60 });
    const ciudad = texto(d.ciudad ?? '', 'La ciudad', { obligatorio: false, max: 60 });
    const activa = d.activa ?? true;
    const repetida = ctx.db.get('SELECT id FROM bodegas WHERE codigo = ? AND id <> ?', [codigo, d.id ?? -1]);
    if (repetida) throw new ErrorDominio('Ya existe una bodega con ese código.', 'conflicto');
    if (d.id) {
      if (!ctx.db.get('SELECT id FROM bodegas WHERE id = ?', [d.id])) noEncontrado('La bodega');
      if (!activa) {
        const otras = ctx.db.escalar('SELECT COUNT(*) FROM bodegas WHERE activa = 1 AND id <> ?', [d.id]);
        if (otras === 0) throw new ErrorDominio('Debe quedar al menos una bodega activa.', 'estado');
        const unidades = ctx.db.escalar('SELECT COALESCE(SUM(cantidad), 0) FROM existencias WHERE bodega_id = ?', [d.id]);
        if (unidades > 0) throw new ErrorDominio(`La bodega aún tiene ${unidades} unidades. Trasládalas antes de desactivarla.`, 'estado');
      }
      ctx.db.run('UPDATE bodegas SET codigo = ?, nombre = ?, ciudad = ?, activa = ? WHERE id = ?', [codigo, nombre, ciudad, activa ? 1 : 0, d.id]);
      return d.id;
    }
    ctx.db.run('INSERT INTO bodegas (codigo, nombre, ciudad, activa) VALUES (?,?,?,?)', [codigo, nombre, ciudad, activa ? 1 : 0]);
    return ctx.db.ultimoId();
  });
}
