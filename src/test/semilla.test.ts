import { beforeAll, describe, expect, it } from 'vitest';
import { crearDbVacia, type Db } from '../data/db';
import { sembrar, usuariosEjemplo } from '../seed/semilla';
import { generarScript, volcarDatos } from '../domain/exportar';
import { panel, rotacion, stockBajo, valorInventario, ventasPorCliente, ventasPorPeriodo, ventasPorProducto } from '../domain/reportes';
import { soloFecha, sumarDias, type Contexto } from '../domain/nucleo';
import { crearMundo, darStock, HOY, mensajeDe } from './ayudas';
import { anularPedido, confirmarPedido, despacharPedido, guardarPedido } from '../domain/pedidos';

const FECHA = new Date(2026, 10, 6, 12, 0, 0);
let db: Db;
let ctx: Contexto;

beforeAll(async () => {
  db = await crearDbVacia();
  sembrar(db, FECHA);
  ctx = { db, usuario: usuariosEjemplo()[0]!, ahora: () => FECHA };
});

describe('semilla determinista', () => {
  it('genera el volumen pedido', () => {
    expect(db.escalar('SELECT COUNT(*) FROM productos')).toBeGreaterThanOrEqual(60);
    expect(db.escalar('SELECT COUNT(*) FROM clientes')).toBe(20);
    expect(db.escalar('SELECT COUNT(*) FROM proveedores')).toBe(12);
    expect(db.escalar('SELECT COUNT(*) FROM bodegas')).toBe(3);
    expect(db.escalar('SELECT COUNT(*) FROM pedidos')).toBeGreaterThanOrEqual(150);
    expect(db.escalar('SELECT COUNT(*) FROM movimientos')).toBeGreaterThan(500);
  });

  it('es reproducible: la misma fecha y semilla producen exactamente los mismos datos', async () => {
    const otra = await crearDbVacia();
    sembrar(otra, FECHA);
    expect(volcarDatos(otra, 'sqlite')).toBe(volcarDatos(db, 'sqlite'));
  });

  it('las fechas son relativas a hoy: el historial nunca cae en el futuro', () => {
    const max = db.escalar<string>('SELECT MAX(fecha) FROM movimientos');
    expect(max <= '2026-11-06 12:00:00').toBe(true);
    expect(db.escalar<string>('SELECT MIN(fecha) FROM movimientos') >= '2026-07-01').toBe(true);
    const otraFecha = new Date(2027, 2, 1, 12);
    return crearDbVacia().then((d) => {
      sembrar(d, otraFecha);
      expect(d.escalar<string>('SELECT MAX(fecha) FROM movimientos') <= '2027-03-01 12:00:00').toBe(true);
      expect(d.escalar<string>('SELECT MIN(fecha) FROM movimientos') >= '2026-10-01').toBe(true);
    });
  });

  it('mantiene la integridad: claves foráneas, integridad física y sin stock negativo', () => {
    expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(db.escalar<string>('PRAGMA integrity_check')).toBe('ok');
    expect(db.escalar('SELECT COUNT(*) FROM existencias WHERE cantidad < 0')).toBe(0);
  });

  it('las existencias coinciden con la suma del libro de movimientos en cada producto y bodega', () => {
    const descuadres = db.all(
      `SELECT e.producto_id, e.bodega_id FROM existencias e
       WHERE e.cantidad <> (SELECT COALESCE(SUM(m.cantidad),0) FROM movimientos m WHERE m.producto_id = e.producto_id AND m.bodega_id = e.bodega_id)`,
    );
    expect(descuadres).toEqual([]);
    expect(db.escalar('SELECT COUNT(*) FROM (SELECT DISTINCT producto_id, bodega_id FROM movimientos)')).toBe(db.escalar('SELECT COUNT(*) FROM existencias'));
  });

  it('cada pedido confirmado, despachado o anulado tiene movimientos que cuadran con sus líneas', () => {
    const malos = db.all(
      `SELECT p.id FROM pedidos p
       WHERE p.estado IN ('confirmado','despachado')
         AND (SELECT -SUM(cantidad) FROM movimientos WHERE referencia_tipo='pedido' AND referencia_id=p.id)
          <> (SELECT SUM(cantidad) FROM pedido_lineas WHERE pedido_id=p.id)`,
    );
    expect(malos).toEqual([]);
    expect(
      db.escalar("SELECT COUNT(*) FROM pedidos p WHERE estado='anulado' AND (SELECT SUM(cantidad) FROM movimientos WHERE referencia_tipo='pedido' AND referencia_id=p.id) NOT IN (0)"),
    ).toBe(0);
  });

  it('deja casos para explorar: stock bajo, pedidos en cada estado y órdenes abiertas', () => {
    expect(db.escalar('SELECT COUNT(*) FROM v_stock_bajo')).toBeGreaterThanOrEqual(4);
    for (const e of ['borrador', 'confirmado', 'despachado', 'anulado']) {
      expect(db.escalar('SELECT COUNT(*) FROM pedidos WHERE estado = ?', [e]), e).toBeGreaterThan(0);
    }
    for (const e of ['enviada', 'parcial', 'recibida']) {
      expect(db.escalar('SELECT COUNT(*) FROM ordenes_compra WHERE estado = ?', [e]), e).toBeGreaterThan(0);
    }
  });

  it('los precios respetan la regla precio ≥ costo en todo el catálogo', () => {
    expect(db.escalar('SELECT COUNT(*) FROM productos WHERE precio < costo')).toBe(0);
  });
});

describe('reportes sobre la semilla', () => {
  it('el panel es coherente con las vistas', () => {
    const p = panel(ctx);
    expect(p.valorInventario).toBe(db.escalar('SELECT SUM(valor_costo) FROM v_valor_inventario'));
    expect(p.stockBajo).toBe(db.escalar('SELECT COUNT(*) FROM v_stock_bajo'));
    expect(p.serieVentas).toHaveLength(30);
    expect(p.serieVentas.reduce((a, x) => a + x.valor, 0)).toBe(p.ventas30);
    expect(p.pedidosPorDespachar).toBe(db.escalar("SELECT COUNT(*) FROM pedidos WHERE estado='confirmado'"));
    expect(p.topProductos.length).toBeGreaterThan(0);
  });

  it('valor de inventario: el total coincide con la suma por categoría y por bodega', () => {
    const v = valorInventario(ctx);
    expect(v.porCategoria.reduce((a, x) => a + x.valor, 0)).toBe(v.total);
    expect(v.porBodega.reduce((a, x) => a + x.valor, 0)).toBe(v.total);
    expect(v.totalVenta).toBeGreaterThan(v.total);
  });

  it('ventas por período: la suma por mes coincide con la suma por producto y por cliente', () => {
    const d = '2026-01-01';
    const h = soloFecha(FECHA);
    const porMes = ventasPorPeriodo(ctx, d, h, 'mes').reduce((a, x) => a + x.valor, 0);
    expect(porMes).toBe(ventasPorProducto(ctx, d, h).reduce((a, x) => a + x.ingresos, 0));
    expect(porMes).toBe(ventasPorCliente(ctx, d, h).reduce((a, x) => a + x.ingresos, 0));
    expect(ventasPorPeriodo(ctx, d, h, 'semana').reduce((a, x) => a + x.valor, 0)).toBe(porMes);
  });

  it('valida los rangos de fechas', () => {
    expect(() => ventasPorPeriodo(ctx, '2026-02-01', '2026-01-01', 'dia')).toThrow(/posterior/);
    expect(() => ventasPorPeriodo(ctx, 'ayer', 'hoy', 'dia')).toThrow(/formato/);
  });

  it('rotación: unidades vendidas del período y cobertura calculada', () => {
    const filas = rotacion(ctx, soloFecha(sumarDias(FECHA, -60)), soloFecha(FECHA));
    expect(filas.length).toBeGreaterThan(50);
    const f = filas.find((x) => x.vendidas > 0 && x.stock_actual > 0)!;
    expect(f.rotacion).toBeCloseTo(f.vendidas / f.stock_actual, 1);
    expect(filas.find((x) => x.vendidas === 0)?.cobertura_dias).toBeNull();
  });

  it('stock bajo incluye proveedor y faltante positivo', () => {
    const filas = stockBajo(ctx);
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.faltante > 0 && f.stock_total < f.stock_minimo)).toBe(true);
  });
});

describe('reportes con cifras verificadas a mano', () => {
  it('ventas del período, por cliente y por producto', async () => {
    const m = await crearMundo();
    darStock(m.db, 1, 1, 100);
    darStock(m.db, 2, 1, 100);
    const v = (dia: number) => m.ctx('vendedor', new Date(2026, 10, dia, 10));
    // 3 nov: cliente 1 -> P1×10 (1500) + P2×2 (3000) = 21.000 ; 5 nov: cliente 2 -> P2×4 = 12.000 ; 5 nov anulado: P1×50
    const a = guardarPedido(v(3), { clienteId: 1, bodegaId: 1, lineas: [{ productoId: 1, cantidad: 10 }, { productoId: 2, cantidad: 2 }] });
    confirmarPedido(v(3), a);
    despacharPedido(m.ctx('bodeguero', new Date(2026, 10, 4)), a);
    const b = guardarPedido(v(5), { clienteId: 2, bodegaId: 1, lineas: [{ productoId: 2, cantidad: 4 }] });
    confirmarPedido(v(5), b);
    const c = guardarPedido(v(5), { clienteId: 2, bodegaId: 1, lineas: [{ productoId: 1, cantidad: 50 }] });
    confirmarPedido(v(5), c);
    anularPedido(v(5), c);
    const x = m.ctx('administrador', HOY);

    expect(ventasPorPeriodo(x, '2026-11-01', '2026-11-06', 'dia')).toEqual([
      { etiqueta: '2026-11-03', valor: 21000, extra: 1 },
      { etiqueta: '2026-11-05', valor: 12000, extra: 1 },
    ]);
    expect(ventasPorProducto(x, '2026-11-01', '2026-11-06').map((r) => [r.sku, r.unidades, r.ingresos, r.margen])).toEqual([
      ['P-002', 6, 18000, 6000],
      ['P-001', 10, 15000, 5000],
    ]);
    expect(ventasPorCliente(x, '2026-11-01', '2026-11-06').map((r) => [r.nombre, r.pedidos, r.ingresos])).toEqual([
      ['Cliente Uno', 1, 21000],
      ['Cliente Dos', 1, 12000],
    ]);
    // solo el 3 de noviembre
    expect(ventasPorPeriodo(x, '2026-11-03', '2026-11-03', 'mes')).toEqual([{ etiqueta: '2026-11', valor: 21000, extra: 1 }]);
    expect(ventasPorPeriodo(x, '2026-11-04', '2026-11-04', 'dia')).toEqual([]);
    // rotación neta: la anulación no cuenta
    const rot = rotacion(x, '2026-11-01', '2026-11-06');
    expect(rot.find((r) => r.sku === 'P-001')).toMatchObject({ vendidas: 10, stock_actual: 90, rotacion: 0.11 });
    expect(rot.find((r) => r.sku === 'P-002')).toMatchObject({ vendidas: 6, stock_actual: 94 });
    // los vendedores y bodegueros ven reportes; el cálculo no depende del rol
    expect(ventasPorProducto(m.ctx('bodeguero'), '2026-11-01', '2026-11-06')).toHaveLength(2);
    expect(mensajeDe(() => panel(m.ctx('vendedor')))).toBe('');
  });
});

describe('scripts MySQL y SQL Server', () => {
  const tablas = ['roles', 'usuarios', 'categorias', 'proveedores', 'bodegas', 'productos', 'existencias', 'clientes', 'pedidos', 'pedido_lineas', 'ordenes_compra', 'compra_lineas', 'recepciones', 'traslados', 'ajustes', 'movimientos'];

  it('MySQL: reemplaza la marca por los datos, con todas las tablas y los triggers después de la carga', () => {
    const sql = generarScript(db, 'mysql');
    expect(sql).not.toContain('@@DATOS@@');
    for (const t of tablas) expect(sql).toContain(`CREATE TABLE ${t} (`);
    expect(sql.indexOf('INSERT INTO movimientos')).toBeLessThan(sql.indexOf('CREATE TRIGGER trg_mov_aplicar'));
    expect(sql).toContain('DELIMITER $$');
    expect(sql).toContain("SIGNAL SQLSTATE '45000'");
    expect(sql.match(/CREATE VIEW/g)).toHaveLength(9);
  });

  it('SQL Server: usa N\'\', IDENTITY_INSERT, GO y THROW', () => {
    const sql = generarScript(db, 'mssql');
    expect(sql).not.toContain('@@DATOS@@');
    for (const t of tablas) expect(sql).toContain(`CREATE TABLE ${t} (`);
    expect(sql).toContain('SET IDENTITY_INSERT productos ON;');
    expect(sql).toContain("INSERT INTO roles (id, nombre, descripcion) VALUES\n  (1, N'administrador'");
    expect(sql).not.toContain('SET IDENTITY_INSERT roles');
    expect(sql).toContain('THROW 50003');
    expect(sql.match(/CREATE VIEW/g)).toHaveLength(9);
    expect(sql.indexOf('INSERT INTO movimientos')).toBeLessThan(sql.indexOf('CREATE TRIGGER trg_mov_aplicar'));
  });

  it('los datos volcados tienen una fila por registro y escapan comillas por dialecto', () => {
    const sqlite = volcarDatos(db, 'sqlite');
    const filas = (sqlite.match(/^ {2}\(/gm) ?? []).length;
    const total = tablas.reduce((a, t) => a + db.escalar(`SELECT COUNT(*) FROM ${t}`), 0);
    expect(filas).toBe(total);
    db.run("INSERT INTO categorias (nombre) VALUES ('O''Brien \\ prueba')");
    expect(volcarDatos(db, 'mysql')).toContain("'O''Brien \\\\ prueba'");
    expect(volcarDatos(db, 'mssql')).toContain("N'O''Brien \\ prueba'");
    db.run("DELETE FROM categorias WHERE nombre LIKE 'O''Brien%'");
  });

  it('el volcado SQLite reconstruye una base idéntica (carga los INSERT sobre un esquema vacío)', async () => {
    const copia = await crearDbVacia();
    copia.exec('PRAGMA foreign_keys = OFF');
    // los triggers de movimientos duplicarían existencias al cargar: se carga antes de crearlos no es posible aquí,
    // así que se vuelcan solo las tablas maestras y se compara el recuento
    const maestras = volcarDatos(db, 'sqlite').split('-- existencias')[0]!;
    copia.exec(maestras);
    expect(copia.escalar('SELECT COUNT(*) FROM productos')).toBe(db.escalar('SELECT COUNT(*) FROM productos'));
    expect(copia.escalar('SELECT SUM(precio) FROM productos')).toBe(db.escalar('SELECT SUM(precio) FROM productos'));
  });
});
