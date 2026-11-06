import esquemaV1 from '../sql/schema.sqlite.sql?raw';

export interface Migracion {
  version: number;
  descripcion: string;
  sql: string;
}

/** Cada migración se aplica una vez y se registra en PRAGMA user_version. */
export const MIGRACIONES: Migracion[] = [
  { version: 1, descripcion: 'Esquema inicial: catálogo, pedidos, compras, movimientos', sql: esquemaV1 },
];
