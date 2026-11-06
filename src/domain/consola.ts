import { type Contexto, ErrorDominio, exigir } from './nucleo';

export interface ResultadoConsulta {
  columnas: string[];
  filas: (string | number | null)[][];
  truncado: boolean;
  milisegundos: number;
}

const LIMITE_FILAS = 500;
const PERMITIDAS = /^\s*(select|with|explain|pragma\s+(table_info|table_xinfo|index_list|index_info|foreign_key_list|user_version))\b/i;

/** Quita comentarios y literales para analizar la estructura de la sentencia. */
function sinLiterales(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * Consola de solo lectura: una única sentencia SELECT/WITH/EXPLAIN o PRAGMA
 * informativo. Además se ejecuta con `PRAGMA query_only`, de modo que el motor
 * rechaza cualquier escritura aunque el filtro anterior fallara.
 */
export function ejecutarConsulta(ctx: Contexto, sql: string): ResultadoConsulta {
  exigir(ctx, 'sql.consultar');
  const limpio = sinLiterales(sql).trim().replace(/;\s*$/, '');
  if (!limpio) throw new ErrorDominio('Escribe una consulta SELECT.');
  if (limpio.includes(';')) throw new ErrorDominio('Solo se admite una sentencia por ejecución.');
  if (!PERMITIDAS.test(limpio)) {
    throw new ErrorDominio('La consola es de solo lectura: usa SELECT, WITH, EXPLAIN o PRAGMA table_info.');
  }
  const inicio = performance.now();
  try {
    return ctx.db.soloLectura(() => {
      const resultados = ctx.db.exec(sql);
      const primero = resultados[0];
      const filas = (primero?.values ?? []) as (string | number | null)[][];
      return {
        columnas: primero?.columns ?? [],
        filas: filas.slice(0, LIMITE_FILAS),
        truncado: filas.length > LIMITE_FILAS,
        milisegundos: Math.round((performance.now() - inicio) * 10) / 10,
      };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErrorDominio(/readonly|read-only/i.test(msg) ? 'La consola es de solo lectura.' : `SQL: ${msg}`, 'sql');
  }
}

export interface EsquemaObjeto {
  tipo: 'table' | 'view' | 'trigger' | 'index';
  nombre: string;
  tabla: string;
  sql: string;
  columnas: { nombre: string; tipo: string; obligatoria: boolean; pk: boolean }[];
}

export function leerEsquema(ctx: Contexto): EsquemaObjeto[] {
  exigir(ctx, 'sql.consultar');
  const objetos = ctx.db.all<{ type: EsquemaObjeto['tipo']; name: string; tbl_name: string; sql: string | null }>(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'view' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, name",
  );
  return objetos.map((o) => ({
    tipo: o.type,
    nombre: o.name,
    tabla: o.tbl_name,
    sql: o.sql ?? '',
    columnas:
      o.type === 'table' || o.type === 'view'
        ? ctx.db
            .all<{ name: string; type: string; notnull: number; pk: number }>(`PRAGMA table_info("${o.name.replace(/"/g, '""')}")`)
            .map((c) => ({ nombre: c.name, tipo: c.type, obligatoria: c.notnull === 1, pk: c.pk > 0 }))
        : [],
  }));
}
