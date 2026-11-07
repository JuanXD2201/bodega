import type { Db } from '../data/db';

export type Rol = 'administrador' | 'vendedor' | 'bodeguero';

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
}

export interface Contexto {
  db: Db;
  usuario: Usuario;
  ahora: () => Date;
}

export class ErrorDominio extends Error {
  constructor(
    mensaje: string,
    readonly codigo: 'validacion' | 'permiso' | 'estado' | 'stock' | 'no_encontrado' | 'conflicto' | 'sql' = 'validacion',
    readonly detalles: string[] = [],
  ) {
    super(mensaje);
    this.name = 'ErrorDominio';
  }
}

// ---------------------------------------------------------------- permisos

export const PERMISOS = [
  'productos.ver', 'productos.editar',
  'existencias.ver', 'existencias.ajustar', 'existencias.trasladar',
  'pedidos.ver', 'pedidos.crear', 'pedidos.confirmar', 'pedidos.despachar', 'pedidos.anular',
  'compras.ver', 'compras.gestionar', 'compras.recibir',
  'clientes.ver', 'clientes.editar',
  'proveedores.ver', 'proveedores.editar',
  'reportes.ver', 'auditoria.ver', 'sql.consultar', 'bd.administrar', 'perfiles.administrar',
] as const;
export type Permiso = (typeof PERMISOS)[number];

const PERMISOS_POR_ROL: Record<Rol, readonly Permiso[]> = {
  administrador: PERMISOS,
  vendedor: [
    'productos.ver', 'existencias.ver',
    'pedidos.ver', 'pedidos.crear', 'pedidos.confirmar', 'pedidos.anular',
    'clientes.ver', 'clientes.editar',
    'reportes.ver', 'sql.consultar',
  ],
  bodeguero: [
    'productos.ver',
    'existencias.ver', 'existencias.ajustar', 'existencias.trasladar',
    'pedidos.ver', 'pedidos.despachar',
    'compras.ver', 'compras.recibir',
    'proveedores.ver',
    'reportes.ver', 'auditoria.ver', 'sql.consultar',
  ],
};

export const ETIQUETA_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  vendedor: 'Vendedor',
  bodeguero: 'Bodeguero',
};

export function tienePermiso(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS_POR_ROL[rol].includes(permiso);
}

export function exigir(ctx: Contexto, permiso: Permiso): void {
  if (!tienePermiso(ctx.usuario.rol, permiso)) {
    throw new ErrorDominio(
      `Tu rol (${ETIQUETA_ROL[ctx.usuario.rol]}) no tiene permiso para esta operación.`,
      'permiso',
    );
  }
}

// ------------------------------------------------------------------ fechas

const dos = (n: number) => String(n).padStart(2, '0');

/** Fecha local en el formato de la base: 'AAAA-MM-DD HH:MM:SS'. */
export function aTexto(d: Date): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

export function soloFecha(d: Date): string {
  return aTexto(d).slice(0, 10);
}

export function sumarDias(d: Date, dias: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + dias);
  return r;
}

// ------------------------------------------------------------- utilidades

/** Traduce los mensajes del motor a texto comprensible. */
export function traducirError(e: unknown): ErrorDominio {
  if (e instanceof ErrorDominio) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const unico = /UNIQUE constraint failed: (\w+)\.(\w+)/.exec(msg);
  if (unico) {
    const campos: Record<string, string> = {
      'productos.sku': 'Ya existe un producto con ese SKU.',
      'clientes.documento': 'Ya existe un cliente con ese documento.',
      'proveedores.nit': 'Ya existe un proveedor con ese NIT.',
      'categorias.nombre': 'Ya existe una categoría con ese nombre.',
      'bodegas.codigo': 'Ya existe una bodega con ese código.',
    };
    return new ErrorDominio(campos[`${unico[1]}.${unico[2]}`] ?? `Valor duplicado en ${unico[1]}.${unico[2]}.`, 'conflicto');
  }
  if (/FOREIGN KEY constraint failed/.test(msg)) {
    return new ErrorDominio('El registro está relacionado con otros datos y no se puede completar la operación.', 'conflicto');
  }
  if (/Stock insuficiente/.test(msg)) return new ErrorDominio(msg.replace(/^.*?Stock/, 'Stock'), 'stock');
  if (/CHECK constraint failed/.test(msg)) return new ErrorDominio('Algún valor no cumple las restricciones de la base de datos.', 'validacion', [msg]);
  if (/no está permitida|no se pueden|Solo se pueden|No se puede|no admite|supera lo pendiente|no puede ser menor/i.test(msg)) {
    return new ErrorDominio(msg, 'estado');
  }
  return new ErrorDominio(msg, 'sql');
}

/** Ejecuta con permiso y transacción; cualquier fallo revierte y se traduce. */
export function operar<T>(ctx: Contexto, permiso: Permiso | null, fn: () => T): T {
  if (permiso) exigir(ctx, permiso);
  try {
    return ctx.db.transaccion(fn);
  } catch (e) {
    throw traducirError(e);
  }
}

export function texto(valor: unknown, campo: string, { obligatorio = true, max = 120 } = {}): string {
  const t = typeof valor === 'string' ? valor.trim() : '';
  if (obligatorio && !t) throw new ErrorDominio(`${campo} es obligatorio.`);
  if (t.length > max) throw new ErrorDominio(`${campo} no puede superar ${max} caracteres.`);
  return t;
}

export function entero(valor: unknown, campo: string, { min = 0, max = 1_000_000_000 } = {}): number {
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : NaN;
  if (!Number.isInteger(n)) throw new ErrorDominio(`${campo} debe ser un número entero.`);
  if (n < min) throw new ErrorDominio(`${campo} debe ser mayor o igual a ${min}.`);
  if (n > max) throw new ErrorDominio(`${campo} es demasiado grande.`);
  return n;
}

export function noEncontrado(que: string): never {
  throw new ErrorDominio(`${que} no existe.`, 'no_encontrado');
}

/** Escapa los comodines de LIKE para búsquedas literales. */
export function patronLike(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
