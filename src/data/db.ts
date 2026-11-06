import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { MIGRACIONES } from './migraciones';

export type Valor = string | number | null;
export type Parametros = Valor[];
export type Fila = Record<string, Valor>;

/**
 * Envoltura delgada sobre sql.js: SQL siempre parametrizado, transacciones
 * anidables (con puntos de guardado) y reemplazo del archivo completo.
 */
export class Db {
  private profundidad = 0;
  constructor(
    private readonly SQL: SqlJsStatic,
    private raw: Database,
  ) {
    this.configurar();
  }

  private configurar() {
    this.raw.run('PRAGMA foreign_keys = ON');
  }

  run(sql: string, params: Parametros = []): void {
    this.raw.run(sql, params);
  }

  all<T extends object = Fila>(sql: string, params: Parametros = []): T[] {
    const stmt = this.raw.prepare(sql);
    try {
      stmt.bind(params);
      const filas: T[] = [];
      while (stmt.step()) filas.push(stmt.getAsObject() as T);
      return filas;
    } finally {
      stmt.free();
    }
  }

  get<T extends object = Fila>(sql: string, params: Parametros = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  escalar<T extends Valor = number>(sql: string, params: Parametros = []): T {
    const fila = this.get(sql, params);
    const valor = fila ? Object.values(fila)[0] : null;
    return (valor ?? 0) as T;
  }

  ultimoId(): number {
    return this.escalar('SELECT last_insert_rowid()');
  }

  /** Ejecuta `fn` de forma atómica: si lanza, se revierte todo lo hecho dentro. */
  transaccion<T>(fn: () => T): T {
    const nivel = this.profundidad;
    const punto = `sp_${nivel}`;
    this.raw.run(nivel === 0 ? 'BEGIN' : `SAVEPOINT ${punto}`);
    this.profundidad++;
    try {
      const resultado = fn();
      this.profundidad--;
      this.raw.run(nivel === 0 ? 'COMMIT' : `RELEASE ${punto}`);
      return resultado;
    } catch (e) {
      this.profundidad--;
      try {
        this.raw.run(nivel === 0 ? 'ROLLBACK' : `ROLLBACK TO ${punto}; RELEASE ${punto}`);
      } catch {
        /* la transacción ya se había cerrado */
      }
      throw e;
    }
  }

  /** Ejecuta con `query_only` activo: cualquier escritura falla en el motor. */
  soloLectura<T>(fn: () => T): T {
    this.raw.run('PRAGMA query_only = ON');
    try {
      return fn();
    } finally {
      this.raw.run('PRAGMA query_only = OFF');
    }
  }

  exec(sql: string) {
    return this.raw.exec(sql);
  }

  exportar(): Uint8Array {
    return this.raw.export();
  }

  /** Sustituye la base completa (deshacer, importar, restablecer). */
  reemplazar(bytes: Uint8Array | null): void {
    try {
      this.raw.close();
    } catch {
      /* ya cerrada */
    }
    this.raw = bytes ? new this.SQL.Database(bytes) : new this.SQL.Database();
    this.profundidad = 0;
    this.configurar();
  }

  cerrar() {
    this.raw.close();
  }
}

export function migrar(db: Db): void {
  const actual = db.escalar('PRAGMA user_version');
  for (const m of MIGRACIONES) {
    if (m.version <= actual) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export const VERSION_ESQUEMA = MIGRACIONES[MIGRACIONES.length - 1]?.version ?? 0;

export type CargadorSql = (opciones?: { locateFile?: (f: string) => string }) => Promise<SqlJsStatic>;

let cacheSQL: Promise<SqlJsStatic> | null = null;

/** Carga el motor WASM una sola vez. En el navegador se sirve desde public/. */
export function cargarMotor(locateFile?: (f: string) => string): Promise<SqlJsStatic> {
  cacheSQL ??= initSqlJs(locateFile ? { locateFile } : undefined);
  return cacheSQL;
}

/** Base vacía con el esquema migrado (sin datos). */
export async function crearDbVacia(locateFile?: (f: string) => string): Promise<Db> {
  const SQL = await cargarMotor(locateFile);
  const db = new Db(SQL, new SQL.Database());
  migrar(db);
  return db;
}

export async function abrirDesdeBytes(bytes: Uint8Array, locateFile?: (f: string) => string): Promise<Db> {
  const SQL = await cargarMotor(locateFile);
  const db = new Db(SQL, new SQL.Database(bytes));
  migrar(db);
  return db;
}
