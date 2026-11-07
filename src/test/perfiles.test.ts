import { beforeEach, describe, expect, it } from 'vitest';
import { crearDbVacia } from '../data/db';
import { buscarGlobal } from '../domain/busqueda';
import { generarScript } from '../domain/exportar';
import { esperaTrasFallos } from '../domain/intentos';
import { ErrorDominio } from '../domain/nucleo';
import { eliminarCategoria, guardarBodega, guardarCategoria, listarBodegasOrg, listarCategoriasOrg } from '../domain/organizacion';
import {
  BODEGA_INICIAL, cambiarMiPin, CATEGORIAS_INICIALES, credencialDe, eliminarPerfil, guardarPerfil, inicializarBaseVacia, listarPerfiles, perfilesActivos,
} from '../domain/perfiles';
import { aHex, crearCredencial, deHex, derivarHash, igualesEnTiempoConstante, validarPin, verificarPin } from '../domain/pin';
import { crearMundo, darStock, HOY, USUARIOS, type Mundo } from './ayudas';

const mensaje = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ErrorDominio ? e.message : String(e);
  }
  return '';
};

describe('PIN: PBKDF2-SHA-256 con sal y comparación en tiempo constante', () => {
  it('valida el formato: de 4 a 8 dígitos', () => {
    expect(validarPin('1234')).toBeNull();
    expect(validarPin('12345678')).toBeNull();
    for (const malo of ['', '123', '123456789', '12a4', ' 1234', '12.34']) expect(validarPin(malo)).not.toBeNull();
  });

  it('el mismo PIN con sales distintas produce hashes distintos y ambos verifican', async () => {
    const a = await crearCredencial('4821', 1000);
    const b = await crearCredencial('4821', 1000);
    expect(a.sal).not.toBe(b.sal);
    expect(a.hash).not.toBe(b.hash);
    expect(a.sal).toHaveLength(32);
    expect(a.hash).toHaveLength(64);
    expect(await verificarPin('4821', a)).toBe(true);
    expect(await verificarPin('4821', b)).toBe(true);
  });

  it('rechaza un PIN incorrecto y una credencial corrupta', async () => {
    const c = await crearCredencial('4821', 1000);
    expect(await verificarPin('4822', c)).toBe(false);
    expect(await verificarPin('', c)).toBe(false);
    expect(await verificarPin('4821', { ...c, hash: 'zz' })).toBe(false);
    expect(await verificarPin('4821', { ...c, sal: c.sal.slice(1) })).toBe(false);
  });

  it('coincide con el vector conocido de PBKDF2-HMAC-SHA256', async () => {
    // RFC 7914 §11: P="passwd", S="salt", c=1, dkLen=64 -> los primeros 32 bytes son estos.
    const hash = await derivarHash('passwd', new TextEncoder().encode('salt'), 1);
    expect(aHex(hash)).toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
  });

  it('el comparador es exacto y distingue longitudes', () => {
    expect(igualesEnTiempoConstante(deHex('00ff10'), deHex('00ff10'))).toBe(true);
    expect(igualesEnTiempoConstante(deHex('00ff10'), deHex('00ff11'))).toBe(false);
    expect(igualesEnTiempoConstante(deHex('00ff'), deHex('00ff00'))).toBe(false);
    expect(igualesEnTiempoConstante(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it('la espera tras fallos crece', () => {
    expect([0, 1, 2].map(esperaTrasFallos)).toEqual([0, 0, 0]);
    expect(esperaTrasFallos(3)).toBe(5_000);
    expect(esperaTrasFallos(5)).toBe(30_000);
    expect(esperaTrasFallos(9)).toBe(300_000);
  });
});

describe('perfiles de acceso locales', () => {
  let m: Mundo;
  beforeEach(async () => {
    m = await crearMundo();
  });

  it('solo el administrador lista, crea, edita y elimina perfiles', () => {
    expect(mensaje(() => listarPerfiles(m.ctx('vendedor')))).toMatch(/no tiene permiso/);
    expect(mensaje(() => guardarPerfil(m.ctx('bodeguero'), { nombre: 'Nuevo', rol: 'vendedor' }))).toMatch(/no tiene permiso/);
    expect(mensaje(() => eliminarPerfil(m.ctx('vendedor'), 3))).toMatch(/no tiene permiso/);
    expect(listarPerfiles(m.ctx()).length).toBe(4);
  });

  it('crea un perfil con PIN y solo guarda hash y sal, nunca el PIN', async () => {
    const credencial = await crearCredencial('7391', 1000);
    const id = guardarPerfil(m.ctx(), { nombre: 'Rosa Gómez', rol: 'bodeguero', credencial });
    const fila = m.db.get<Record<string, unknown>>('SELECT * FROM usuarios WHERE id = ?', [id])!;
    expect(JSON.stringify(fila)).not.toContain('7391');
    expect(fila.pin_hash).toBe(credencial.hash);
    expect(fila.pin_sal).toBe(credencial.sal);
    expect(fila.pin_iteraciones).toBe(1000);
    expect(await verificarPin('7391', credencialDe(m.db, id)!)).toBe(true);
    expect(perfilesActivos(m.db).find((p) => p.id === id)?.tienePin).toBe(true);
  });

  it('valida nombre, rol y duplicados sin distinguir mayúsculas', () => {
    expect(mensaje(() => guardarPerfil(m.ctx(), { nombre: ' ', rol: 'vendedor' }))).toMatch(/obligatorio/);
    expect(mensaje(() => guardarPerfil(m.ctx(), { nombre: 'A', rol: 'vendedor' }))).toMatch(/al menos 2/);
    expect(mensaje(() => guardarPerfil(m.ctx(), { nombre: 'Algo', rol: 'root' as never }))).toMatch(/rol no es válido/);
    expect(mensaje(() => guardarPerfil(m.ctx(), { nombre: 'vendedor uno', rol: 'vendedor' }))).toMatch(/Ya existe un perfil/);
  });

  it('editar conserva el PIN salvo que se indique; null lo quita', async () => {
    const credencial = await crearCredencial('1357', 1000);
    const id = guardarPerfil(m.ctx(), { nombre: 'Pedro Gil', rol: 'vendedor', credencial });
    guardarPerfil(m.ctx(), { id, nombre: 'Pedro Gil Ruiz', rol: 'bodeguero' });
    expect(credencialDe(m.db, id)?.hash).toBe(credencial.hash);
    expect(perfilesActivos(m.db).find((p) => p.id === id)).toMatchObject({ nombre: 'Pedro Gil Ruiz', rol: 'bodeguero' });
    guardarPerfil(m.ctx(), { id, nombre: 'Pedro Gil Ruiz', rol: 'bodeguero', credencial: null });
    expect(credencialDe(m.db, id)).toBeNull();
  });

  it('siempre queda un administrador activo', () => {
    expect(mensaje(() => guardarPerfil(m.ctx(), { id: 1, nombre: 'Admin Prueba', rol: 'vendedor' }))).toMatch(/al menos un administrador/);
    const otro = guardarPerfil(m.ctx(), { nombre: 'Segundo Admin', rol: 'administrador' });
    // ya hay dos: desactivar al otro es válido; desactivarse a sí mismo no
    guardarPerfil(m.ctx(), { id: otro, nombre: 'Segundo Admin', rol: 'administrador', activo: false });
    expect(mensaje(() => guardarPerfil(m.ctx(), { id: 1, nombre: 'Admin Prueba', rol: 'administrador', activo: false }))).toMatch(/al menos un administrador|con el que estás trabajando/);
    expect(mensaje(() => eliminarPerfil(m.ctx(), 1))).toMatch(/con el que estás trabajando/);
  });

  it('un perfil desactivado no aparece en el acceso; uno con historial no se elimina', () => {
    darStock(m.db, 1, 1, 10);
    const nuevo = guardarPerfil(m.ctx(), { nombre: 'Temporal', rol: 'vendedor' });
    guardarPerfil(m.ctx(), { id: nuevo, nombre: 'Temporal', rol: 'vendedor', activo: false });
    expect(perfilesActivos(m.db).some((p) => p.id === nuevo)).toBe(false);
    eliminarPerfil(m.ctx(), nuevo);
    expect(m.db.get('SELECT id FROM usuarios WHERE id = ?', [nuevo])).toBeUndefined();
    m.db.run("INSERT INTO ajustes (producto_id, bodega_id, cantidad, motivo, fecha, usuario_id) VALUES (1, 1, 1, 'conteo', '2026-11-06 10:00:00', 4)");
    expect(mensaje(() => eliminarPerfil(m.ctx(), 4))).toMatch(/Desactívalo/);
    expect(m.db.get('SELECT id FROM usuarios WHERE id = 4')).toBeDefined();
  });

  it('cualquiera puede cambiar su propio PIN, pero solo el suyo', async () => {
    const credencial = await crearCredencial('2468', 1000);
    cambiarMiPin(m.ctx('vendedor'), credencial);
    expect(credencialDe(m.db, USUARIOS.vendedor.id)?.hash).toBe(credencial.hash);
    expect(credencialDe(m.db, USUARIOS.administrador.id)).toBeNull();
    cambiarMiPin(m.ctx('vendedor'), null);
    expect(credencialDe(m.db, USUARIOS.vendedor.id)).toBeNull();
  });

  it('el script exportado para MySQL no incluye los hashes de PIN', async () => {
    const credencial = await crearCredencial('9753', 1000);
    guardarPerfil(m.ctx(), { nombre: 'Con Pin', rol: 'vendedor', credencial });
    const sql = generarScript(m.db, 'mysql');
    expect(sql).toContain('Con Pin');
    expect(sql).not.toContain(credencial.hash);
    expect(sql).not.toContain(credencial.sal);
    expect(sql).not.toContain('pin_hash');
    // el esquema SQLite sí declara las columnas (migración 2)
    expect(generarScript(m.db, 'sqlite')).toContain('pin_hash');
  });
});

describe('base vacía con primer perfil', () => {
  it('queda utilizable: roles, una bodega, categorías y el administrador', async () => {
    const db = await crearDbVacia();
    const credencial = await crearCredencial('4455', 1000);
    const admin = inicializarBaseVacia(db, { nombre: 'Juana Ramírez', credencial });
    expect(admin).toMatchObject({ nombre: 'Juana Ramírez', rol: 'administrador' });
    expect(db.escalar('SELECT COUNT(*) FROM roles')).toBe(3);
    expect(db.get<{ codigo: string }>('SELECT codigo FROM bodegas')?.codigo).toBe(BODEGA_INICIAL.codigo);
    expect(db.escalar('SELECT COUNT(*) FROM categorias')).toBe(CATEGORIAS_INICIALES.length);
    expect(db.escalar('SELECT COUNT(*) FROM productos')).toBe(0);
    expect(db.escalar('SELECT COUNT(*) FROM pedidos')).toBe(0);
    expect(perfilesActivos(db)).toHaveLength(1);
    expect(await verificarPin('4455', credencialDe(db, admin.id)!)).toBe(true);
  });

  it('exige un nombre y es atómica si algo falla', async () => {
    const db = await crearDbVacia();
    expect(mensaje(() => inicializarBaseVacia(db, { nombre: '' }))).toMatch(/obligatorio/);
    expect(db.escalar('SELECT COUNT(*) FROM roles')).toBe(0);
  });

  it('un administrador puede trabajar de inmediato con la base vacía', async () => {
    const db = await crearDbVacia();
    const admin = inicializarBaseVacia(db, { nombre: 'Juana Ramírez' });
    const ctx = { db, usuario: admin, ahora: () => HOY };
    expect(listarCategoriasOrg(ctx).length).toBe(CATEGORIAS_INICIALES.length);
    expect(listarBodegasOrg(ctx)).toHaveLength(1);
  });
});

describe('organización: categorías y bodegas', () => {
  let m: Mundo;
  beforeEach(async () => {
    m = await crearMundo();
  });

  it('crea, edita y valida categorías; no elimina una con productos', () => {
    const id = guardarCategoria(m.ctx(), { nombre: 'Cat C', descripcion: 'Nueva' });
    expect(listarCategoriasOrg(m.ctx()).find((c) => c.id === id)).toMatchObject({ nombre: 'Cat C', productos: 0 });
    expect(mensaje(() => guardarCategoria(m.ctx(), { nombre: 'cat c' }))).toMatch(/Ya existe/);
    guardarCategoria(m.ctx(), { id, nombre: 'Cat C2' });
    expect(mensaje(() => eliminarCategoria(m.ctx(), 1))).toMatch(/tiene \d+ productos?/);
    eliminarCategoria(m.ctx(), id);
    expect(listarCategoriasOrg(m.ctx()).some((c) => c.id === id)).toBe(false);
    expect(mensaje(() => guardarCategoria(m.ctx('vendedor'), { nombre: 'X1' }))).toMatch(/no tiene permiso/);
  });

  it('crea bodegas, normaliza el código y no desactiva una con stock ni la última activa', () => {
    const id = guardarBodega(m.ctx(), { codigo: 'bar', nombre: 'Barranquilla', ciudad: 'Barranquilla' });
    expect(listarBodegasOrg(m.ctx()).find((b) => b.id === id)?.codigo).toBe('BAR');
    expect(mensaje(() => guardarBodega(m.ctx(), { codigo: 'BAR', nombre: 'Otra' }))).toMatch(/Ya existe una bodega/);
    expect(mensaje(() => guardarBodega(m.ctx(), { codigo: 'X', nombre: 'Corta' }))).toMatch(/entre 2 y 10/);
    darStock(m.db, 1, id, 5);
    expect(mensaje(() => guardarBodega(m.ctx(), { id, codigo: 'BAR', nombre: 'Barranquilla', activa: false }))).toMatch(/Trasládalas/);
    m.db.run('UPDATE bodegas SET activa = 0 WHERE id <> 1');
    expect(mensaje(() => guardarBodega(m.ctx(), { id: 1, codigo: 'BOG', nombre: 'Bogotá', activa: false }))).toMatch(/al menos una bodega activa/);
    expect(mensaje(() => guardarBodega(m.ctx('bodeguero'), { codigo: 'ZZ', nombre: 'Zeta' }))).toMatch(/no tiene permiso/);
  });
});

describe('búsqueda global', () => {
  let m: Mundo;
  beforeEach(async () => {
    m = await crearMundo();
    darStock(m.db, 1, 1, 20);
  });

  it('pide al menos 2 caracteres', () => {
    expect(buscarGlobal(m.ctx(), '')).toEqual([]);
    expect(buscarGlobal(m.ctx(), 'p')).toEqual([]);
  });

  it('encuentra productos por SKU o nombre y terceros por nombre o documento', () => {
    const r = buscarGlobal(m.ctx(), 'p-00');
    expect(r.filter((x) => x.tipo === 'producto').map((x) => x.titulo)).toContain('P-001 · Producto uno');
    expect(buscarGlobal(m.ctx(), 'cliente uno').some((x) => x.tipo === 'cliente')).toBe(true);
    expect(buscarGlobal(m.ctx(), '222').some((x) => x.tipo === 'proveedor')).toBe(true);
  });

  it('respeta los permisos del rol', () => {
    const vendedor = buscarGlobal(m.ctx('vendedor'), 'proveedor');
    expect(vendedor.some((x) => x.tipo === 'proveedor' || x.tipo === 'orden')).toBe(false);
    expect(buscarGlobal(m.ctx('bodeguero'), 'proveedor').some((x) => x.tipo === 'proveedor')).toBe(true);
    expect(buscarGlobal(m.ctx('bodeguero'), 'cliente').some((x) => x.tipo === 'cliente')).toBe(false);
  });

  it('trata los comodines de LIKE y las comillas como texto literal', () => {
    expect(buscarGlobal(m.ctx(), '%%')).toEqual([]);
    expect(buscarGlobal(m.ctx(), "p' OR '1'='1")).toEqual([]);
    expect(buscarGlobal(m.ctx(), 'p_00')).toEqual([]);
  });

  it('abre pedidos y órdenes por número', () => {
    m.db.run("INSERT INTO pedidos (numero, cliente_id, usuario_id, bodega_id, fecha) VALUES ('PED-2026-0001', 1, 2, 1, '2026-11-06 10:00:00')");
    const r = buscarGlobal(m.ctx(), 'PED-2026');
    expect(r).toEqual([expect.objectContaining({ tipo: 'pedido', ruta: expect.stringMatching(/^pedidos\/\d+$/) })]);
  });
});

describe('migración 2 sobre una base de la versión 1', () => {
  it('añade las columnas de PIN y conserva los usuarios existentes', async () => {
    const { MIGRACIONES } = await import('../data/migraciones');
    const { abrirDesdeBytes, cargarMotor } = await import('../data/db');
    const SQL = await cargarMotor();
    const vieja = new SQL.Database();
    vieja.exec(MIGRACIONES[0]!.sql);
    vieja.exec("INSERT INTO roles VALUES (1,'administrador','a'),(2,'vendedor','v'),(3,'bodeguero','b')");
    vieja.exec("INSERT INTO usuarios (nombre, email, rol_id) VALUES ('Antigua', 'antigua@x.test', 1)");
    vieja.exec('PRAGMA user_version = 1');
    const db = await abrirDesdeBytes(vieja.export());
    expect(db.escalar('PRAGMA user_version')).toBe(2);
    expect(perfilesActivos(db)).toEqual([expect.objectContaining({ nombre: 'Antigua', rol: 'administrador', tienePin: false })]);
    expect(credencialDe(db, 1)).toBeNull();
  });
});
