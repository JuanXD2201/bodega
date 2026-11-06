import { type Contexto, ErrorDominio, noEncontrado, operar, patronLike, texto, exigir } from './nucleo';

export interface Cliente {
  id: number; nombre: string; documento: string; email: string; telefono: string; ciudad: string; activo: number;
  pedidos: number; ingresos: number;
}
export interface Proveedor {
  id: number; nombre: string; nit: string; contacto: string; email: string; telefono: string; ciudad: string; activo: number;
  productos: number;
}

export interface DatosTercero {
  id?: number;
  nombre: string;
  documento: string; // documento del cliente o NIT del proveedor
  contacto?: string;
  email?: string;
  telefono?: string;
  ciudad?: string;
  activo?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validar(d: DatosTercero, etiquetaDoc: string) {
  const email = texto(d.email ?? '', 'El correo', { obligatorio: false, max: 120 });
  if (email && !EMAIL.test(email)) throw new ErrorDominio('El correo electrónico no es válido.');
  const telefono = texto(d.telefono ?? '', 'El teléfono', { obligatorio: false, max: 20 });
  if (telefono && !/^[0-9+()\-\s]{7,20}$/.test(telefono)) throw new ErrorDominio('El teléfono solo admite dígitos, espacios, + - ( ).');
  return {
    nombre: texto(d.nombre, 'El nombre', { max: 120 }),
    documento: texto(d.documento, etiquetaDoc, { max: 30 }),
    contacto: texto(d.contacto ?? '', 'El contacto', { obligatorio: false, max: 80 }),
    email,
    telefono,
    ciudad: texto(d.ciudad ?? '', 'La ciudad', { obligatorio: false, max: 60 }),
    activo: d.activo === false ? 0 : 1,
  };
}

export function listarClientes(ctx: Contexto, q = ''): Cliente[] {
  exigir(ctx, 'clientes.ver');
  return ctx.db.all<Cliente>(
    `SELECT c.id, c.nombre, c.documento, c.email, c.telefono, c.ciudad, c.activo,
            COALESCE(v.pedidos, 0) AS pedidos, COALESCE(v.ingresos, 0) AS ingresos
     FROM clientes c LEFT JOIN v_ventas_cliente v ON v.cliente_id = c.id
     WHERE (? = '' OR c.nombre LIKE ? ESCAPE '\\' OR c.documento LIKE ? ESCAPE '\\')
     ORDER BY c.nombre COLLATE NOCASE`,
    [q.trim(), patronLike(q), patronLike(q)],
  );
}

export function guardarCliente(ctx: Contexto, d: DatosTercero): number {
  return operar(ctx, 'clientes.editar', () => {
    const v = validar(d, 'El documento');
    if (d.id) {
      if (!ctx.db.get('SELECT id FROM clientes WHERE id = ?', [d.id])) noEncontrado('El cliente');
      ctx.db.run('UPDATE clientes SET nombre=?, documento=?, email=?, telefono=?, ciudad=?, activo=? WHERE id=?',
        [v.nombre, v.documento, v.email, v.telefono, v.ciudad, v.activo, d.id]);
      return d.id;
    }
    ctx.db.run('INSERT INTO clientes (nombre, documento, email, telefono, ciudad, activo) VALUES (?,?,?,?,?,?)',
      [v.nombre, v.documento, v.email, v.telefono, v.ciudad, v.activo]);
    return ctx.db.ultimoId();
  });
}

export function eliminarCliente(ctx: Contexto, id: number): 'eliminado' | 'desactivado' {
  return operar(ctx, 'clientes.editar', () => {
    if (!ctx.db.get('SELECT id FROM clientes WHERE id = ?', [id])) noEncontrado('El cliente');
    if (ctx.db.escalar('SELECT COUNT(*) FROM pedidos WHERE cliente_id = ?', [id]) > 0) {
      ctx.db.run('UPDATE clientes SET activo = 0 WHERE id = ?', [id]);
      return 'desactivado';
    }
    ctx.db.run('DELETE FROM clientes WHERE id = ?', [id]);
    return 'eliminado';
  });
}

export function listarProveedores(ctx: Contexto, q = ''): Proveedor[] {
  exigir(ctx, 'proveedores.ver');
  return ctx.db.all<Proveedor>(
    `SELECT p.id, p.nombre, p.nit, p.contacto, p.email, p.telefono, p.ciudad, p.activo,
            (SELECT COUNT(*) FROM productos x WHERE x.proveedor_id = p.id) AS productos
     FROM proveedores p
     WHERE (? = '' OR p.nombre LIKE ? ESCAPE '\\' OR p.nit LIKE ? ESCAPE '\\')
     ORDER BY p.nombre COLLATE NOCASE`,
    [q.trim(), patronLike(q), patronLike(q)],
  );
}

export function guardarProveedor(ctx: Contexto, d: DatosTercero): number {
  return operar(ctx, 'proveedores.editar', () => {
    const v = validar(d, 'El NIT');
    if (d.id) {
      if (!ctx.db.get('SELECT id FROM proveedores WHERE id = ?', [d.id])) noEncontrado('El proveedor');
      ctx.db.run('UPDATE proveedores SET nombre=?, nit=?, contacto=?, email=?, telefono=?, ciudad=?, activo=? WHERE id=?',
        [v.nombre, v.documento, v.contacto, v.email, v.telefono, v.ciudad, v.activo, d.id]);
      return d.id;
    }
    ctx.db.run('INSERT INTO proveedores (nombre, nit, contacto, email, telefono, ciudad, activo) VALUES (?,?,?,?,?,?,?)',
      [v.nombre, v.documento, v.contacto, v.email, v.telefono, v.ciudad, v.activo]);
    return ctx.db.ultimoId();
  });
}

export function eliminarProveedor(ctx: Contexto, id: number): 'eliminado' | 'desactivado' {
  return operar(ctx, 'proveedores.editar', () => {
    if (!ctx.db.get('SELECT id FROM proveedores WHERE id = ?', [id])) noEncontrado('El proveedor');
    const usos =
      ctx.db.escalar('SELECT COUNT(*) FROM ordenes_compra WHERE proveedor_id = ?', [id]) +
      ctx.db.escalar('SELECT COUNT(*) FROM productos WHERE proveedor_id = ?', [id]);
    if (usos > 0) {
      ctx.db.run('UPDATE proveedores SET activo = 0 WHERE id = ?', [id]);
      return 'desactivado';
    }
    ctx.db.run('DELETE FROM proveedores WHERE id = ?', [id]);
    return 'eliminado';
  });
}
