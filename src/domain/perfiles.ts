import type { Db } from '../data/db';
import { ROLES } from '../seed/catalogo-ejemplo';
import { ErrorDominio, exigir, noEncontrado, operar, texto, type Contexto, type Rol, type Usuario } from './nucleo';
import type { Credencial } from './pin';

export const ROLES_VALIDOS: readonly Rol[] = ['administrador', 'vendedor', 'bodeguero'];

export interface Perfil extends Usuario {
  activo: boolean;
  tienePin: boolean;
}

interface FilaPerfil {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  activo: number;
  pin_hash: string | null;
}

const SELECT_PERFIL = `SELECT u.id, u.nombre, u.email, r.nombre AS rol, u.activo, u.pin_hash
  FROM usuarios u JOIN roles r ON r.id = u.rol_id`;

const aPerfil = (f: FilaPerfil): Perfil => ({ id: f.id, nombre: f.nombre, email: f.email, rol: f.rol, activo: f.activo === 1, tienePin: f.pin_hash !== null });

/** Perfiles con los que se puede entrar (activos), para el selector de acceso. */
export function perfilesActivos(db: Db): Perfil[] {
  return db.all<FilaPerfil>(`${SELECT_PERFIL} WHERE u.activo = 1 ORDER BY u.id`).map(aPerfil);
}

export function listarPerfiles(ctx: Contexto): Perfil[] {
  exigir(ctx, 'perfiles.administrar');
  return ctx.db.all<FilaPerfil>(`${SELECT_PERFIL} ORDER BY u.activo DESC, u.id`).map(aPerfil);
}

/** Datos de PIN de un perfil para verificarlo al entrar; null si el perfil no tiene PIN. */
export function credencialDe(db: Db, id: number): Credencial | null {
  const f = db.get<{ pin_hash: string | null; pin_sal: string | null; pin_iteraciones: number | null }>(
    'SELECT pin_hash, pin_sal, pin_iteraciones FROM usuarios WHERE id = ?', [id],
  );
  if (!f || !f.pin_hash || !f.pin_sal || !f.pin_iteraciones) return null;
  return { hash: f.pin_hash, sal: f.pin_sal, iteraciones: f.pin_iteraciones };
}

export interface DatosPerfil {
  id?: number;
  nombre: string;
  rol: Rol;
  activo?: boolean;
  /** undefined: mantener el PIN actual. null: quitarlo. Credencial: establecer uno nuevo. */
  credencial?: Credencial | null;
}

function otrosAdministradoresActivos(db: Db, excluirId: number | null): number {
  return db.escalar(
    `SELECT COUNT(*) FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE r.nombre = 'administrador' AND u.activo = 1 AND u.id <> ?`,
    [excluirId ?? -1],
  );
}

/** Crea o edita un perfil. Solo el administrador; siempre debe quedar al menos un administrador activo. */
export function guardarPerfil(ctx: Contexto, d: DatosPerfil): number {
  return operar(ctx, 'perfiles.administrar', () => {
    const nombre = texto(d.nombre, 'El nombre', { max: 60 });
    if (nombre.length < 2) throw new ErrorDominio('El nombre debe tener al menos 2 caracteres.');
    if (!ROLES_VALIDOS.includes(d.rol)) throw new ErrorDominio('El rol no es válido.');
    const activo = d.activo ?? true;
    const repetido = ctx.db.get('SELECT id FROM usuarios WHERE lower(nombre) = lower(?) AND id <> ?', [nombre, d.id ?? -1]);
    if (repetido) throw new ErrorDominio('Ya existe un perfil con ese nombre.', 'conflicto');
    const rolId = ctx.db.get<{ id: number }>('SELECT id FROM roles WHERE nombre = ?', [d.rol])?.id;
    if (!rolId) throw new ErrorDominio('El rol no existe en la base.');

    if (d.id) {
      const actual = ctx.db.get<{ id: number }>('SELECT id FROM usuarios WHERE id = ?', [d.id]);
      if (!actual) noEncontrado('El perfil');
      const eraAdmin = ctx.db.get('SELECT 1 FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ? AND r.nombre = ? AND u.activo = 1', [d.id, 'administrador']);
      if (eraAdmin && (d.rol !== 'administrador' || !activo) && otrosAdministradoresActivos(ctx.db, d.id) === 0) {
        throw new ErrorDominio('Debe quedar al menos un administrador activo.', 'estado');
      }
      if (d.id === ctx.usuario.id && !activo) throw new ErrorDominio('No puedes desactivar el perfil con el que estás trabajando.', 'estado');
      ctx.db.run('UPDATE usuarios SET nombre = ?, rol_id = ?, activo = ? WHERE id = ?', [nombre, rolId, activo ? 1 : 0, d.id]);
      if (d.credencial !== undefined) aplicarCredencial(ctx.db, d.id, d.credencial);
      return d.id;
    }

    // El esquema exige un correo único: los perfiles locales llevan uno interno que no se muestra.
    const interno = `perfil-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@bodega.local`;
    ctx.db.run('INSERT INTO usuarios (nombre, email, rol_id, activo) VALUES (?,?,?,?)', [nombre, interno, rolId, activo ? 1 : 0]);
    const id = ctx.db.ultimoId();
    if (d.credencial) aplicarCredencial(ctx.db, id, d.credencial);
    return id;
  });
}

function aplicarCredencial(db: Db, id: number, c: Credencial | null): void {
  if (c === null) db.run('UPDATE usuarios SET pin_hash = NULL, pin_sal = NULL, pin_iteraciones = NULL WHERE id = ?', [id]);
  else db.run('UPDATE usuarios SET pin_hash = ?, pin_sal = ?, pin_iteraciones = ? WHERE id = ?', [c.hash, c.sal, c.iteraciones, id]);
}

/** Cambia el PIN del perfil en uso. La interfaz verifica antes el PIN actual. */
export function cambiarMiPin(ctx: Contexto, c: Credencial | null): void {
  operar(ctx, null, () => aplicarCredencial(ctx.db, ctx.usuario.id, c));
}

/** Tablas que guardan historial a nombre de un usuario (cualquier tabla con columna usuario_id). */
function tablasConHistorial(db: Db): string[] {
  return db
    .all<{ name: string }>(
      `SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) p
       WHERE m.type = 'table' AND p.name = 'usuario_id'`,
    )
    .map((t) => t.name);
}

/** Elimina un perfil sin historial. Si ya operó, hay que desactivarlo para conservar la auditoría. */
export function eliminarPerfil(ctx: Contexto, id: number): void {
  operar(ctx, 'perfiles.administrar', () => {
    if (id === ctx.usuario.id) throw new ErrorDominio('No puedes eliminar el perfil con el que estás trabajando.', 'estado');
    const perfil = ctx.db.get<{ rol: Rol; activo: number }>('SELECT r.nombre AS rol, u.activo FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?', [id]);
    if (!perfil) noEncontrado('El perfil');
    if (perfil.rol === 'administrador' && perfil.activo === 1 && otrosAdministradoresActivos(ctx.db, id) === 0) {
      throw new ErrorDominio('Debe quedar al menos un administrador activo.', 'estado');
    }
    for (const tabla of tablasConHistorial(ctx.db)) {
      if (ctx.db.escalar(`SELECT COUNT(*) FROM ${tabla} WHERE usuario_id = ?`, [id]) > 0) {
        throw new ErrorDominio('Este perfil ya registró operaciones y su historial se conserva en la auditoría. Desactívalo en lugar de eliminarlo.', 'conflicto');
      }
    }
    ctx.db.run('DELETE FROM usuarios WHERE id = ?', [id]);
  });
}

// --------------------------------------------------------- base vacía

export const BODEGA_INICIAL = { codigo: 'PRI', nombre: 'Bodega principal' } as const;
export const CATEGORIAS_INICIALES = ['General', 'Materia prima', 'Producto terminado', 'Insumos', 'Herramientas'] as const;

/**
 * Deja una base recién migrada lista para trabajar sin datos: los tres roles,
 * una bodega, categorías básicas y el primer perfil, que es administrador.
 */
export function inicializarBaseVacia(db: Db, primerPerfil: { nombre: string; credencial?: Credencial | null }): Usuario {
  const nombre = texto(primerPerfil.nombre, 'El nombre', { max: 60 });
  if (nombre.length < 2) throw new ErrorDominio('El nombre debe tener al menos 2 caracteres.');
  return db.transaccion(() => {
    for (const r of ROLES) db.run('INSERT INTO roles (id, nombre, descripcion) VALUES (?,?,?)', [r.id, r.nombre, r.descripcion]);
    db.run('INSERT INTO bodegas (codigo, nombre) VALUES (?,?)', [BODEGA_INICIAL.codigo, BODEGA_INICIAL.nombre]);
    for (const c of CATEGORIAS_INICIALES) db.run('INSERT INTO categorias (nombre) VALUES (?)', [c]);
    const email = `perfil-${Date.now().toString(36)}@bodega.local`;
    db.run('INSERT INTO usuarios (nombre, email, rol_id) VALUES (?,?,1)', [nombre, email]);
    const id = db.ultimoId();
    if (primerPerfil.credencial) aplicarCredencial(db, id, primerPerfil.credencial);
    return { id, nombre, email, rol: 'administrador' as const };
  });
}
