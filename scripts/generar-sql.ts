/**
 * Genera sql/schema.mysql.sql y sql/schema.mssql.sql (esquema + datos de la semilla demo)
 * con una fecha de referencia fija, para que los archivos publicados en el repositorio
 * sean reproducibles.   Uso: npm run sql:generar
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { crearDbVacia } from '../src/data/db';
import { generarScript } from '../src/domain/exportar';
import { sembrar } from '../src/seed/semilla';

const REFERENCIA = new Date(2026, 10, 6, 12, 0, 0);

const db = await crearDbVacia();
const resumen = sembrar(db, REFERENCIA);
mkdirSync('sql', { recursive: true });
for (const dialecto of ['mysql', 'mssql'] as const) {
  const archivo = `sql/schema.${dialecto}.sql`;
  writeFileSync(archivo, generarScript(db, dialecto), 'utf8');
  console.log(`${archivo} generado`);
}
console.log(resumen);
