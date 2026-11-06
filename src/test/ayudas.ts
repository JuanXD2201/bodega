import { crearDbVacia, type Db } from '../data/db';
import type { Contexto, Rol, Usuario } from '../domain/nucleo';

export const HOY = new Date(2026, 10, 6, 12, 0, 0);

export const USUARIOS: Record<Rol, Usuario> = {
  administrador: { id: 1, nombre: 'Admin Prueba', email: 'admin@t.test', rol: 'administrador' },
  vendedor: { id: 2, nombre: 'Vendedor Uno', email: 'v1@t.test', rol: 'vendedor' },
  bodeguero: { id: 4, nombre: 'Bodeguero Uno', email: 'b1@t.test', rol: 'bodeguero' },
};
export const OTRO_VENDEDOR: Usuario = { id: 3, nombre: 'Vendedor Dos', email: 'v2@t.test', rol: 'vendedor' };

export interface Mundo {
  db: Db;
  /** Contexto para un rol (por defecto, con el reloj fijo en HOY). */
  ctx: (rol?: Rol | Usuario, fecha?: Date) => Contexto;
}

/**
 * Base real en memoria con un mundo mínimo y conocido:
 *  productos 1..5 (P1 costo 1000/precio 1500 mín 5, P2 2000/3000 mín 10, P3 500/800 mín 0,
 *  P4 10000/12000 mín 2 inactivo, P5 4000/5000 mín 20), bodegas 1..3, clientes 1..2, proveedores 1..2.
 */
export async function crearMundo(): Promise<Mundo> {
  const db = await crearDbVacia();
  db.transaccion(() => {
    db.run("INSERT INTO roles VALUES (1,'administrador','a'),(2,'vendedor','v'),(3,'bodeguero','b')");
    db.run(`INSERT INTO usuarios (id,nombre,email,rol_id) VALUES
      (1,'Admin Prueba','admin@t.test',1),(2,'Vendedor Uno','v1@t.test',2),(3,'Vendedor Dos','v2@t.test',2),(4,'Bodeguero Uno','b1@t.test',3)`);
    db.run("INSERT INTO categorias (id,nombre) VALUES (1,'Cat A'),(2,'Cat B')");
    db.run("INSERT INTO proveedores (id,nombre,nit) VALUES (1,'Proveedor Uno','111'),(2,'Proveedor Dos','222')");
    db.run("INSERT INTO bodegas (id,codigo,nombre) VALUES (1,'BOG','Bogotá'),(2,'MED','Medellín'),(3,'CAL','Cali')");
    db.run(`INSERT INTO productos (id,sku,nombre,categoria_id,proveedor_id,costo,precio,stock_minimo,activo) VALUES
      (1,'P-001','Producto uno',1,1,1000,1500,5,1),
      (2,'P-002','Producto dos',1,1,2000,3000,10,1),
      (3,'P-003','Producto tres',2,2,500,800,0,1),
      (4,'P-004','Producto cuatro inactivo',2,2,10000,12000,2,0),
      (5,'P-005','Producto cinco',2,2,4000,5000,20,1)`);
    db.run("INSERT INTO clientes (id,nombre,documento) VALUES (1,'Cliente Uno','900'),(2,'Cliente Dos','901')");
  });
  return {
    db,
    ctx: (quien = 'administrador', fecha = HOY) => ({
      db,
      usuario: typeof quien === 'string' ? USUARIOS[quien] : quien,
      ahora: () => fecha,
    }),
  };
}

/** Deja stock directamente mediante un movimiento de entrada (como lo haría una recepción). */
export function darStock(db: Db, productoId: number, bodegaId: number, cantidad: number, fecha = '2026-10-01 08:00:00') {
  db.run(
    `INSERT INTO movimientos (fecha,tipo,producto_id,bodega_id,cantidad,referencia_tipo,referencia_id,usuario_id,nota)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [fecha, 'entrada', productoId, bodegaId, cantidad, 'ajuste', 0, 1, 'stock inicial'],
  );
}

export function stock(db: Db, productoId: number, bodegaId: number): number {
  return db.escalar('SELECT COALESCE((SELECT cantidad FROM existencias WHERE producto_id=? AND bodega_id=?),0)', [productoId, bodegaId]);
}

/** Captura el mensaje de error de una operación síncrona. */
export function mensajeDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '';
}
