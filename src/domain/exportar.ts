import type { Db, Valor } from '../data/db';
import sqlite from '../sql/schema.sqlite.sql?raw';
import mysql from '../sql/schema.mysql.sql?raw';
import mssql from '../sql/schema.mssql.sql?raw';

export type Dialecto = 'sqlite' | 'mysql' | 'mssql';

const MARCA = '-- @@DATOS@@';

/** Tablas en orden de dependencia (las referenciadas primero). */
const TABLAS = [
  'roles', 'usuarios', 'categorias', 'proveedores', 'bodegas', 'productos', 'existencias', 'clientes',
  'pedidos', 'pedido_lineas', 'ordenes_compra', 'compra_lineas', 'recepciones', 'traslados', 'ajustes', 'movimientos',
] as const;

const SIN_IDENTIDAD = new Set(['roles', 'existencias']);
const POR_SENTENCIA = 250;

function literal(v: Valor, d: Dialecto): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  const t = v.replace(/'/g, "''");
  if (d === 'mysql') return `'${t.replace(/\\/g, '\\\\')}'`;
  if (d === 'mssql') return `N'${t}'`;
  return `'${t}'`;
}

/** Vuelca los datos actuales como INSERT del dialecto indicado. */
export function volcarDatos(db: Db, dialecto: Dialecto): string {
  const salida: string[] = [];
  for (const tabla of TABLAS) {
    const filas = db.all(`SELECT * FROM ${tabla} ORDER BY ${tabla === 'existencias' ? 'producto_id, bodega_id' : 'id'}`);
    if (!filas.length) continue;
    const columnas = Object.keys(filas[0]!);
    const identidad = dialecto === 'mssql' && !SIN_IDENTIDAD.has(tabla);
    salida.push(`-- ${tabla} (${filas.length} filas)`);
    if (identidad) salida.push(`SET IDENTITY_INSERT ${tabla} ON;`);
    for (let i = 0; i < filas.length; i += POR_SENTENCIA) {
      const lote = filas.slice(i, i + POR_SENTENCIA);
      salida.push(
        `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES\n` +
          lote.map((f) => `  (${columnas.map((c) => literal(f[c] ?? null, dialecto)).join(', ')})`).join(',\n') +
          ';',
      );
    }
    if (identidad) salida.push(`SET IDENTITY_INSERT ${tabla} OFF;`);
    if (dialecto === 'mssql') salida.push('GO');
    salida.push('');
  }
  return salida.join('\n');
}

export const NOMBRES_SCRIPT: Record<Dialecto, string> = {
  sqlite: 'schema.sqlite.sql',
  mysql: 'schema.mysql.sql',
  mssql: 'schema.mssql.sql',
};

/**
 * Script completo del dialecto: esquema escrito a mano + los datos actuales de
 * la base. En SQLite el script es solo el esquema (la base ya tiene los datos).
 */
export function generarScript(db: Db, dialecto: Dialecto): string {
  if (dialecto === 'sqlite') return sqlite;
  const plantilla = dialecto === 'mysql' ? mysql : mssql;
  return plantilla.replace(MARCA, volcarDatos(db, dialecto));
}
