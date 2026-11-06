import { beforeEach, describe, expect, it } from 'vitest';
import { migrar, VERSION_ESQUEMA } from '../data/db';
import { crearMundo, darStock, stock, type Mundo } from './ayudas';

let m: Mundo;
beforeEach(async () => {
  m = await crearMundo();
});

let n = 0;
function nuevoPedido(estado = 'borrador', bodega = 1): number {
  n++;
  m.db.run(
    "INSERT INTO pedidos (numero,cliente_id,usuario_id,bodega_id,estado,fecha) VALUES (?,1,2,?,?,'2026-11-01 10:00:00')",
    [`PV-T${n}`, bodega, estado],
  );
  return m.db.ultimoId();
}
const linea = (pedido: number, producto: number, cantidad: number, precio = 1500) =>
  m.db.run('INSERT INTO pedido_lineas (pedido_id,producto_id,cantidad,precio_unitario) VALUES (?,?,?,?)', [pedido, producto, cantidad, precio]);
const confirmar = (id: number, fecha = '2026-11-02 09:00:00') =>
  m.db.run("UPDATE pedidos SET estado='confirmado', fecha_confirmacion=? WHERE id=?", [fecha, id]);

function nuevaOrden(estado = 'borrador'): number {
  n++;
  m.db.run(
    "INSERT INTO ordenes_compra (numero,proveedor_id,bodega_id,usuario_id,estado,fecha) VALUES (?,1,1,1,?,'2026-11-01 10:00:00')",
    [`OC-T${n}`, estado],
  );
  return m.db.ultimoId();
}
const lineaCompra = (orden: number, producto: number, cantidad: number) => {
  m.db.run('INSERT INTO compra_lineas (orden_id,producto_id,cantidad_pedida,costo_unitario) VALUES (?,?,?,1000)', [orden, producto, cantidad]);
  return m.db.ultimoId();
};
const recibir = (linea: number, cantidad: number) =>
  m.db.run("INSERT INTO recepciones (linea_id,cantidad,fecha,usuario_id) VALUES (?,?,'2026-11-03 10:00:00',4)", [linea, cantidad]);

describe('motor y migraciones', () => {
  it('activa las claves foráneas en la conexión', () => {
    expect(m.db.escalar('PRAGMA foreign_keys')).toBe(1);
  });
  it('registra la versión del esquema y no repite migraciones', () => {
    expect(m.db.escalar('PRAGMA user_version')).toBe(VERSION_ESQUEMA);
    expect(() => migrar(m.db)).not.toThrow();
    expect(m.db.escalar('PRAGMA user_version')).toBe(VERSION_ESQUEMA);
  });
  it('crea las 16 tablas, 9 vistas y los índices declarados', () => {
    expect(m.db.escalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).toBe(16);
    expect(m.db.escalar("SELECT COUNT(*) FROM sqlite_master WHERE type='view'")).toBe(9);
    expect(m.db.escalar("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")).toBeGreaterThanOrEqual(12);
  });
});

describe('restricciones de productos', () => {
  const insertar = (sku: string, costo: number, precio: number, extra = 'categoria_id') =>
    m.db.run(`INSERT INTO productos (sku,nombre,${extra},costo,precio) VALUES (?, 'X', 1, ?, ?)`, [sku, costo, precio]);

  it('rechaza SKU duplicado', () => {
    expect(() => insertar('P-001', 1, 2)).toThrow(/UNIQUE/);
  });
  it('rechaza SKU en minúsculas o con caracteres inválidos', () => {
    expect(() => insertar('abc-1', 1, 2)).toThrow(/CHECK/);
    expect(() => insertar('AB C', 1, 2)).toThrow(/CHECK/);
    expect(() => insertar('AB', 1, 2)).toThrow(/CHECK/);
  });
  it('rechaza precio cero y costo negativo', () => {
    expect(() => insertar('N-1', 0, 0)).toThrow(/CHECK/);
    expect(() => insertar('N-2', -1, 5)).toThrow(/CHECK/);
  });
  it('trigger: no permite precio menor al costo al insertar', () => {
    expect(() => insertar('N-3', 2000, 1500)).toThrow(/precio de venta no puede ser menor al costo/);
  });
  it('trigger: no permite precio menor al costo al actualizar', () => {
    expect(() => m.db.run('UPDATE productos SET precio = 900 WHERE id = 1')).toThrow(/menor al costo/);
    expect(() => m.db.run('UPDATE productos SET costo = 2000 WHERE id = 1')).toThrow(/menor al costo/);
    expect(m.db.escalar('SELECT precio FROM productos WHERE id = 1')).toBe(1500);
  });
  it('rechaza categoría inexistente (clave foránea)', () => {
    expect(() => m.db.run("INSERT INTO productos (sku,nombre,categoria_id,costo,precio) VALUES ('F-1','X',99,1,2)")).toThrow(/FOREIGN KEY/);
  });
  it('rechaza borrar una categoría con productos', () => {
    expect(() => m.db.run('DELETE FROM categorias WHERE id = 1')).toThrow(/FOREIGN KEY/);
  });
  it('rechaza stock mínimo negativo', () => {
    expect(() => m.db.run('UPDATE productos SET stock_minimo = -1 WHERE id = 1')).toThrow(/CHECK/);
  });
});

describe('libro de movimientos y existencias', () => {
  it('una entrada crea la fila de existencias y suma', () => {
    darStock(m.db, 1, 1, 30);
    darStock(m.db, 1, 1, 12);
    expect(stock(m.db, 1, 1)).toBe(42);
  });
  it('una salida mayor al stock se rechaza con mensaje claro y no cambia nada', () => {
    darStock(m.db, 1, 1, 5);
    expect(() =>
      m.db.run("INSERT INTO movimientos (fecha,tipo,producto_id,bodega_id,cantidad,referencia_tipo,referencia_id,usuario_id) VALUES ('2026-11-01','salida',1,1,-6,'pedido',1,1)"),
    ).toThrow(/Stock insuficiente/);
    expect(stock(m.db, 1, 1)).toBe(5);
  });
  it('una salida sobre una bodega sin existencias también se rechaza', () => {
    expect(() =>
      m.db.run("INSERT INTO movimientos (fecha,tipo,producto_id,bodega_id,cantidad,referencia_tipo,referencia_id,usuario_id) VALUES ('2026-11-01','salida',1,2,-1,'pedido',1,1)"),
    ).toThrow(/Stock insuficiente/);
  });
  it('la restricción CHECK de existencias impide el negativo aunque se salte el trigger', () => {
    darStock(m.db, 1, 1, 5);
    expect(() => m.db.run('UPDATE existencias SET cantidad = -1 WHERE producto_id = 1 AND bodega_id = 1')).toThrow(/CHECK/);
  });
  it('el signo debe ser coherente con el tipo de movimiento', () => {
    darStock(m.db, 1, 1, 5);
    expect(() =>
      m.db.run("INSERT INTO movimientos (fecha,tipo,producto_id,bodega_id,cantidad,referencia_tipo,referencia_id,usuario_id) VALUES ('2026-11-01','entrada',1,1,-3,'ajuste',1,1)"),
    ).toThrow(/CHECK/);
    expect(() =>
      m.db.run("INSERT INTO movimientos (fecha,tipo,producto_id,bodega_id,cantidad,referencia_tipo,referencia_id,usuario_id) VALUES ('2026-11-01','salida',1,1,3,'pedido',1,1)"),
    ).toThrow(/CHECK/);
  });
  it('un movimiento de cantidad cero es inválido', () => {
    expect(() =>
      m.db.run("INSERT INTO movimientos (fecha,tipo,producto_id,bodega_id,cantidad,referencia_tipo,referencia_id,usuario_id) VALUES ('2026-11-01','ajuste',1,1,0,'ajuste',1,1)"),
    ).toThrow(/CHECK/);
  });
  it('los movimientos no se pueden modificar ni eliminar (auditoría inmutable)', () => {
    darStock(m.db, 1, 1, 5);
    expect(() => m.db.run('UPDATE movimientos SET cantidad = 99')).toThrow(/no se pueden modificar/);
    expect(() => m.db.run('DELETE FROM movimientos')).toThrow(/no se pueden eliminar/);
    expect(stock(m.db, 1, 1)).toBe(5);
  });
  it('no se puede borrar un producto con movimientos', () => {
    darStock(m.db, 1, 1, 5);
    expect(() => m.db.run('DELETE FROM productos WHERE id = 1')).toThrow(/FOREIGN KEY/);
  });
});

describe('pedidos de venta (triggers)', () => {
  it('confirmar descuenta el stock de la bodega y registra un movimiento por línea con la fecha de confirmación', () => {
    darStock(m.db, 1, 1, 20);
    darStock(m.db, 2, 1, 10);
    const p = nuevoPedido();
    linea(p, 1, 8);
    linea(p, 2, 3);
    confirmar(p, '2026-11-02 09:30:00');
    expect(stock(m.db, 1, 1)).toBe(12);
    expect(stock(m.db, 2, 1)).toBe(7);
    const movs = m.db.all<{ tipo: string; cantidad: number; fecha: string; referencia_id: number }>(
      "SELECT tipo,cantidad,fecha,referencia_id FROM movimientos WHERE referencia_tipo='pedido' ORDER BY id",
    );
    expect(movs).toEqual([
      { tipo: 'salida', cantidad: -8, fecha: '2026-11-02 09:30:00', referencia_id: p },
      { tipo: 'salida', cantidad: -3, fecha: '2026-11-02 09:30:00', referencia_id: p },
    ]);
  });

  it('si una línea no tiene stock se revierte el pedido completo (ninguna línea descuenta)', () => {
    darStock(m.db, 1, 1, 20);
    darStock(m.db, 2, 1, 2);
    const p = nuevoPedido();
    linea(p, 1, 8);
    linea(p, 2, 5); // no alcanza
    expect(() => confirmar(p)).toThrow(/Stock insuficiente/);
    expect(stock(m.db, 1, 1)).toBe(20);
    expect(stock(m.db, 2, 1)).toBe(2);
    expect(m.db.escalar("SELECT estado = 'borrador' FROM pedidos WHERE id = ?", [p])).toBe(1);
    expect(m.db.escalar("SELECT COUNT(*) FROM movimientos WHERE referencia_tipo='pedido'")).toBe(0);
  });

  it('el rollback también funciona dentro de una transacción envolvente', () => {
    darStock(m.db, 1, 1, 20);
    const p = nuevoPedido();
    linea(p, 1, 8);
    expect(() =>
      m.db.transaccion(() => {
        confirmar(p);
        throw new Error('falla posterior');
      }),
    ).toThrow(/falla posterior/);
    expect(stock(m.db, 1, 1)).toBe(20);
    expect(m.db.escalar("SELECT estado = 'borrador' FROM pedidos WHERE id = ?", [p])).toBe(1);
  });

  it('no permite confirmar un pedido sin líneas', () => {
    const p = nuevoPedido();
    expect(() => confirmar(p)).toThrow(/sin líneas/);
  });

  it('solo permite las transiciones válidas de estado', () => {
    darStock(m.db, 1, 1, 50);
    const a = nuevoPedido();
    linea(a, 1, 1);
    expect(() => m.db.run("UPDATE pedidos SET estado='despachado' WHERE id=?", [a])).toThrow(/Transición/);
    confirmar(a);
    m.db.run("UPDATE pedidos SET estado='despachado' WHERE id=?", [a]);
    expect(() => m.db.run("UPDATE pedidos SET estado='anulado' WHERE id=?", [a])).toThrow(/Transición/);
    expect(() => m.db.run("UPDATE pedidos SET estado='borrador' WHERE id=?", [a])).toThrow(/Transición/);
    const b = nuevoPedido();
    linea(b, 1, 1);
    m.db.run("UPDATE pedidos SET estado='anulado' WHERE id=?", [b]);
    expect(() => confirmar(b)).toThrow(/Transición/);
  });

  it('anular un pedido confirmado devuelve el stock; anular un borrador no mueve nada', () => {
    darStock(m.db, 1, 1, 20);
    const p = nuevoPedido();
    linea(p, 1, 8);
    confirmar(p);
    expect(stock(m.db, 1, 1)).toBe(12);
    m.db.run("UPDATE pedidos SET estado='anulado', fecha_anulacion='2026-11-03 08:00:00' WHERE id=?", [p]);
    expect(stock(m.db, 1, 1)).toBe(20);
    expect(m.db.get("SELECT tipo,cantidad FROM movimientos WHERE referencia_tipo='pedido' ORDER BY id DESC")).toEqual({ tipo: 'entrada', cantidad: 8 });
    const b = nuevoPedido();
    linea(b, 1, 3);
    m.db.run("UPDATE pedidos SET estado='anulado' WHERE id=?", [b]);
    expect(stock(m.db, 1, 1)).toBe(20);
  });

  it('despachar no vuelve a descontar stock', () => {
    darStock(m.db, 1, 1, 20);
    const p = nuevoPedido();
    linea(p, 1, 8);
    confirmar(p);
    m.db.run("UPDATE pedidos SET estado='despachado' WHERE id=?", [p]);
    expect(stock(m.db, 1, 1)).toBe(12);
  });

  it('las líneas de un pedido no confirmado se pueden editar, las de uno confirmado no', () => {
    darStock(m.db, 1, 1, 20);
    const p = nuevoPedido();
    linea(p, 1, 2);
    m.db.run('UPDATE pedido_lineas SET cantidad = 4 WHERE pedido_id = ?', [p]);
    confirmar(p);
    expect(() => linea(p, 2, 1)).toThrow(/en borrador/);
    expect(() => m.db.run('UPDATE pedido_lineas SET cantidad = 9 WHERE pedido_id = ?', [p])).toThrow(/en borrador/);
    expect(() => m.db.run('DELETE FROM pedido_lineas WHERE pedido_id = ?', [p])).toThrow(/en borrador/);
  });

  it('solo se eliminan borradores; al eliminarlos se van sus líneas', () => {
    darStock(m.db, 1, 1, 20);
    const a = nuevoPedido();
    linea(a, 1, 2);
    m.db.run('DELETE FROM pedidos WHERE id = ?', [a]);
    expect(m.db.escalar('SELECT COUNT(*) FROM pedido_lineas WHERE pedido_id = ?', [a])).toBe(0);
    const b = nuevoPedido();
    linea(b, 1, 2);
    confirmar(b);
    expect(() => m.db.run('DELETE FROM pedidos WHERE id = ?', [b])).toThrow(/borrador/);
  });

  it('restricciones de líneas: cantidad positiva y producto único por pedido', () => {
    const p = nuevoPedido();
    expect(() => linea(p, 1, 0)).toThrow(/CHECK/);
    expect(() => linea(p, 1, -2)).toThrow(/CHECK/);
    linea(p, 1, 2);
    expect(() => linea(p, 1, 3)).toThrow(/UNIQUE/);
  });

  it('número de pedido único y estado restringido', () => {
    const p = nuevoPedido();
    const numero = m.db.get<{ numero: string }>('SELECT numero FROM pedidos WHERE id = ?', [p])!.numero;
    expect(() =>
      m.db.run("INSERT INTO pedidos (numero,cliente_id,usuario_id,bodega_id,fecha) VALUES (?,1,2,1,'2026-11-01')", [numero]),
    ).toThrow(/UNIQUE/);
    expect(() =>
      m.db.run("INSERT INTO pedidos (numero,cliente_id,usuario_id,bodega_id,estado,fecha) VALUES ('X-1',1,2,1,'perdido','2026-11-01')"),
    ).toThrow(/CHECK/);
  });
});

describe('compras y recepciones (triggers)', () => {
  it('recibir parcial y luego completar pasa por parcial y termina en recibida', () => {
    const o = nuevaOrden();
    const l1 = lineaCompra(o, 1, 100);
    const l2 = lineaCompra(o, 2, 40);
    m.db.run("UPDATE ordenes_compra SET estado='enviada' WHERE id=?", [o]);
    recibir(l1, 60);
    expect(stock(m.db, 1, 1)).toBe(60);
    expect(m.db.escalar('SELECT estado FROM ordenes_compra WHERE id=?', [o]) as unknown).toBe('parcial');
    recibir(l1, 40);
    recibir(l2, 40);
    expect(stock(m.db, 1, 1)).toBe(100);
    expect(stock(m.db, 2, 1)).toBe(40);
    expect(m.db.escalar('SELECT estado FROM ordenes_compra WHERE id=?', [o]) as unknown).toBe('recibida');
    expect(m.db.escalar('SELECT cantidad_recibida FROM compra_lineas WHERE id=?', [l1])).toBe(100);
  });

  it('recibir más de lo pendiente se rechaza y no mueve stock', () => {
    const o = nuevaOrden();
    const l = lineaCompra(o, 1, 10);
    m.db.run("UPDATE ordenes_compra SET estado='enviada' WHERE id=?", [o]);
    recibir(l, 6);
    expect(() => recibir(l, 5)).toThrow(/supera lo pendiente/);
    expect(stock(m.db, 1, 1)).toBe(6);
    expect(m.db.escalar('SELECT cantidad_recibida FROM compra_lineas WHERE id=?', [l])).toBe(6);
  });

  it('una orden en borrador, recibida o anulada no admite recepciones', () => {
    const o = nuevaOrden();
    const l = lineaCompra(o, 1, 10);
    expect(() => recibir(l, 1)).toThrow(/no admite recepciones/);
    m.db.run("UPDATE ordenes_compra SET estado='anulada' WHERE id=?", [o]);
    expect(() => recibir(l, 1)).toThrow(/no admite recepciones/);
    const o2 = nuevaOrden();
    const l2 = lineaCompra(o2, 2, 5);
    m.db.run("UPDATE ordenes_compra SET estado='enviada' WHERE id=?", [o2]);
    recibir(l2, 5);
    expect(() => recibir(l2, 1)).toThrow(/no admite recepciones|supera/);
  });

  it('las recepciones registran movimientos de entrada con la fecha de recepción', () => {
    const o = nuevaOrden();
    const l = lineaCompra(o, 3, 25);
    m.db.run("UPDATE ordenes_compra SET estado='enviada' WHERE id=?", [o]);
    recibir(l, 25);
    expect(m.db.get("SELECT tipo,cantidad,fecha,referencia_tipo,referencia_id FROM movimientos")).toEqual({
      tipo: 'entrada', cantidad: 25, fecha: '2026-11-03 10:00:00', referencia_tipo: 'compra', referencia_id: o,
    });
  });

  it('transiciones de orden: no se envía sin líneas ni se salta de borrador a recibida', () => {
    const o = nuevaOrden();
    expect(() => m.db.run("UPDATE ordenes_compra SET estado='enviada' WHERE id=?", [o])).toThrow(/sin líneas/);
    lineaCompra(o, 1, 3);
    expect(() => m.db.run("UPDATE ordenes_compra SET estado='recibida' WHERE id=?", [o])).toThrow(/Transición/);
    m.db.run("UPDATE ordenes_compra SET estado='enviada' WHERE id=?", [o]);
    m.db.run("UPDATE ordenes_compra SET estado='anulada' WHERE id=?", [o]);
    expect(() => m.db.run("UPDATE ordenes_compra SET estado='enviada' WHERE id=?", [o])).toThrow(/Transición/);
  });

  it('las líneas solo cambian en borrador, pero la cantidad recibida sí se actualiza al recibir', () => {
    const o = nuevaOrden();
    const l = lineaCompra(o, 1, 10);
    m.db.run('UPDATE compra_lineas SET cantidad_pedida = 12 WHERE id = ?', [l]);
    m.db.run("UPDATE ordenes_compra SET estado='enviada' WHERE id=?", [o]);
    expect(() => m.db.run('UPDATE compra_lineas SET cantidad_pedida = 20 WHERE id = ?', [l])).toThrow(/en borrador/);
    expect(() => lineaCompra(o, 2, 1)).toThrow(/en borrador/);
    expect(() => m.db.run('DELETE FROM compra_lineas WHERE id = ?', [l])).toThrow(/en borrador/);
    expect(() => recibir(l, 12)).not.toThrow();
  });

  it('cantidad_recibida no puede superar la pedida (CHECK)', () => {
    const o = nuevaOrden();
    const l = lineaCompra(o, 1, 10);
    expect(() => m.db.run('UPDATE compra_lineas SET cantidad_recibida = 11 WHERE id = ?', [l])).toThrow(/CHECK/);
  });
});

describe('traslados y ajustes (triggers)', () => {
  it('un traslado resta en origen, suma en destino y deja dos movimientos enlazados', () => {
    darStock(m.db, 1, 1, 30);
    m.db.run("INSERT INTO traslados (producto_id,origen_id,destino_id,cantidad,fecha,usuario_id) VALUES (1,1,2,12,'2026-11-04 09:00:00',4)");
    expect(stock(m.db, 1, 1)).toBe(18);
    expect(stock(m.db, 1, 2)).toBe(12);
    const movs = m.db.all<{ tipo: string; cantidad: number; bodega_id: number }>(
      "SELECT tipo,cantidad,bodega_id FROM movimientos WHERE referencia_tipo='traslado' ORDER BY id",
    );
    expect(movs).toEqual([
      { tipo: 'traslado_salida', cantidad: -12, bodega_id: 1 },
      { tipo: 'traslado_entrada', cantidad: 12, bodega_id: 2 },
    ]);
  });

  it('un traslado sin stock suficiente es atómico: no deja ni el traslado ni movimientos', () => {
    darStock(m.db, 1, 1, 5);
    expect(() =>
      m.db.run("INSERT INTO traslados (producto_id,origen_id,destino_id,cantidad,fecha,usuario_id) VALUES (1,1,2,9,'2026-11-04',4)"),
    ).toThrow(/Stock insuficiente/);
    expect(stock(m.db, 1, 1)).toBe(5);
    expect(stock(m.db, 1, 2)).toBe(0);
    expect(m.db.escalar('SELECT COUNT(*) FROM traslados')).toBe(0);
  });

  it('el origen y el destino deben ser distintos y la cantidad positiva', () => {
    darStock(m.db, 1, 1, 5);
    expect(() => m.db.run("INSERT INTO traslados (producto_id,origen_id,destino_id,cantidad,fecha,usuario_id) VALUES (1,1,1,2,'2026-11-04',4)")).toThrow(/CHECK/);
    expect(() => m.db.run("INSERT INTO traslados (producto_id,origen_id,destino_id,cantidad,fecha,usuario_id) VALUES (1,1,2,0,'2026-11-04',4)")).toThrow(/CHECK/);
  });

  it('un ajuste positivo suma y uno negativo resta, con su movimiento y motivo', () => {
    m.db.run("INSERT INTO ajustes (producto_id,bodega_id,cantidad,motivo,fecha,usuario_id,nota) VALUES (1,1,10,'conteo','2026-11-04',4,'')");
    m.db.run("INSERT INTO ajustes (producto_id,bodega_id,cantidad,motivo,fecha,usuario_id,nota) VALUES (1,1,-4,'merma','2026-11-04',4,'caja húmeda')");
    expect(stock(m.db, 1, 1)).toBe(6);
    expect(m.db.all<{ nota: string }>("SELECT nota FROM movimientos WHERE tipo='ajuste' ORDER BY id").map((r) => r.nota)).toEqual(['conteo', 'merma: caja húmeda']);
  });

  it('un ajuste negativo mayor al stock se rechaza y un motivo inválido también', () => {
    darStock(m.db, 1, 1, 3);
    expect(() => m.db.run("INSERT INTO ajustes (producto_id,bodega_id,cantidad,motivo,fecha,usuario_id) VALUES (1,1,-4,'merma','2026-11-04',4)")).toThrow(/Stock insuficiente/);
    expect(() => m.db.run("INSERT INTO ajustes (producto_id,bodega_id,cantidad,motivo,fecha,usuario_id) VALUES (1,1,1,'regalo','2026-11-04',4)")).toThrow(/CHECK/);
    expect(() => m.db.run("INSERT INTO ajustes (producto_id,bodega_id,cantidad,motivo,fecha,usuario_id) VALUES (1,1,0,'conteo','2026-11-04',4)")).toThrow(/CHECK/);
    expect(stock(m.db, 1, 1)).toBe(3);
  });
});

describe('vistas con resultados verificados a mano', () => {
  /*
   * Mundo de la vista:
   *   P1 (costo 1000, precio 1500, mín 5): BOG 4 + MED 3 = 7
   *   P2 (costo 2000, precio 3000, mín 10): BOG 6            -> bajo mínimo (faltan 4)
   *   P3 (costo 500,  precio 800,  mín 0): BOG 100
   *   P5 (costo 4000, precio 5000, mín 20): sin existencias  -> bajo mínimo (faltan 20)
   *   P4 inactivo con 0 de mínimo bajo: no debe aparecer en stock bajo
   * Pedidos: A (cliente 1, despachado): P1×2 @1500 + P2×1 @3000 = 6000
   *          B (cliente 2, confirmado): P1×1 @1400 = 1400
   *          C (cliente 1, anulado):    P3×10 @800 = 8000  (no cuenta como venta)
   *          D (cliente 1, borrador):   P2×5 @3000        (no cuenta como venta)
   */
  beforeEach(() => {
    darStock(m.db, 1, 1, 10);
    darStock(m.db, 1, 2, 3);
    darStock(m.db, 2, 1, 10);
    darStock(m.db, 3, 1, 100);
    const a = nuevoPedido();
    linea(a, 1, 2, 1500);
    linea(a, 2, 1, 3000);
    confirmar(a, '2026-11-02 10:00:00');
    m.db.run("UPDATE pedidos SET estado='despachado' WHERE id=?", [a]);
    const b = nuevoPedido();
    m.db.run('UPDATE pedidos SET cliente_id = 2 WHERE id = ?', [b]);
    linea(b, 1, 1, 1400);
    confirmar(b, '2026-11-03 10:00:00');
    const c = nuevoPedido();
    linea(c, 3, 10, 800);
    m.db.run("UPDATE pedidos SET estado='anulado' WHERE id=?", [c]);
    const d = nuevoPedido();
    linea(d, 2, 5, 3000);
    // Tras los pedidos: P1 BOG 10-2-1 = 7 -> se corrige a 4 con un ajuste para el caso de prueba
    m.db.run("INSERT INTO ajustes (producto_id,bodega_id,cantidad,motivo,fecha,usuario_id) VALUES (1,1,-3,'merma','2026-11-04',4)");
    // P2 BOG: 10 - 1 = 9 -> baja a 6
    m.db.run("INSERT INTO ajustes (producto_id,bodega_id,cantidad,motivo,fecha,usuario_id) VALUES (2,1,-3,'merma','2026-11-04',4)");
  });

  it('v_stock_producto suma las existencias de todas las bodegas', () => {
    const filas = m.db.all<{ producto_id: number; stock_total: number }>('SELECT producto_id, stock_total FROM v_stock_producto ORDER BY producto_id');
    expect(filas.map((f) => f.stock_total)).toEqual([7, 6, 100, 0, 0]);
  });

  it('v_stock_bajo lista solo productos activos por debajo del mínimo, con su faltante', () => {
    const filas = m.db.all('SELECT sku, stock_total, stock_minimo, faltante FROM v_stock_bajo ORDER BY sku');
    expect(filas).toEqual([
      { sku: 'P-002', stock_total: 6, stock_minimo: 10, faltante: 4 },
      { sku: 'P-005', stock_total: 0, stock_minimo: 20, faltante: 20 },
    ]);
  });

  it('v_valor_inventario valora a costo y a precio de venta, por producto y bodega', () => {
    const filas = m.db.all('SELECT sku, bodega, cantidad, valor_costo, valor_venta FROM v_valor_inventario ORDER BY sku, bodega');
    expect(filas).toEqual([
      { sku: 'P-001', bodega: 'BOG', cantidad: 4, valor_costo: 4000, valor_venta: 6000 },
      { sku: 'P-001', bodega: 'MED', cantidad: 3, valor_costo: 3000, valor_venta: 4500 },
      { sku: 'P-002', bodega: 'BOG', cantidad: 6, valor_costo: 12000, valor_venta: 18000 },
      { sku: 'P-003', bodega: 'BOG', cantidad: 100, valor_costo: 50000, valor_venta: 80000 },
    ]);
    expect(m.db.escalar('SELECT SUM(valor_costo) FROM v_valor_inventario')).toBe(69000);
  });

  it('v_pedidos_totales calcula líneas, unidades y total', () => {
    const filas = m.db.all('SELECT estado, lineas, unidades, total FROM v_pedidos_totales ORDER BY pedido_id');
    expect(filas).toEqual([
      { estado: 'despachado', lineas: 2, unidades: 3, total: 6000 },
      { estado: 'confirmado', lineas: 1, unidades: 1, total: 1400 },
      { estado: 'anulado', lineas: 1, unidades: 10, total: 8000 },
      { estado: 'borrador', lineas: 1, unidades: 5, total: 15000 },
    ]);
  });

  it('v_ventas_producto cuenta solo pedidos confirmados o despachados, con margen sobre costo', () => {
    const filas = m.db.all('SELECT sku, unidades, ingresos, costo_estimado, margen FROM v_ventas_producto ORDER BY sku');
    expect(filas).toEqual([
      { sku: 'P-001', unidades: 3, ingresos: 4400, costo_estimado: 3000, margen: 1400 },
      { sku: 'P-002', unidades: 1, ingresos: 3000, costo_estimado: 2000, margen: 1000 },
    ]);
  });

  it('v_ventas_cliente agrupa ingresos y pedidos por cliente', () => {
    const filas = m.db.all('SELECT nombre, pedidos, ingresos FROM v_ventas_cliente ORDER BY cliente_id');
    expect(filas).toEqual([
      { nombre: 'Cliente Uno', pedidos: 1, ingresos: 6000 },
      { nombre: 'Cliente Dos', pedidos: 1, ingresos: 1400 },
    ]);
  });

  it('v_rotacion usa ventas netas (la anulación devuelve lo vendido) sobre el stock actual', () => {
    const filas = m.db.all('SELECT sku, unidades_salidas, indice_rotacion FROM v_rotacion ORDER BY sku');
    expect(filas).toEqual([
      { sku: 'P-001', unidades_salidas: 3, indice_rotacion: 0.43 },
      { sku: 'P-002', unidades_salidas: 1, indice_rotacion: 0.17 },
      { sku: 'P-003', unidades_salidas: 0, indice_rotacion: 0 },
      { sku: 'P-004', unidades_salidas: 0, indice_rotacion: null },
      { sku: 'P-005', unidades_salidas: 0, indice_rotacion: null },
    ]);
  });

  it('v_movimientos_detalle une producto, bodega y usuario', () => {
    const f = m.db.get<{ producto: string; bodega: string; usuario: string }>(
      'SELECT producto, bodega, usuario FROM v_movimientos_detalle ORDER BY id LIMIT 1',
    );
    expect(f).toEqual({ producto: 'Producto uno', bodega: 'BOG', usuario: 'Admin Prueba' });
  });
});
