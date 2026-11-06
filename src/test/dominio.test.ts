import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorDominio, PERMISOS, tienePermiso, type Permiso, type Rol } from '../domain/nucleo';
import { eliminarProducto, guardarProducto, listarProductos, obtenerProducto } from '../domain/catalogo';
import { eliminarCliente, guardarCliente, guardarProveedor, listarClientes } from '../domain/terceros';
import { ajustarStock, listarMovimientos, matrizExistencias, trasladarStock } from '../domain/inventario';
import {
  anularPedido, confirmarPedido, despacharPedido, eliminarBorrador, faltantesDeStock, guardarPedido, listarPedidos, obtenerPedido,
} from '../domain/pedidos';
import { anularOrden, enviarOrden, guardarOrden, obtenerOrden, recibirOrden } from '../domain/compras';
import { ejecutarConsulta, leerEsquema } from '../domain/consola';
import { crearMundo, darStock, mensajeDe, OTRO_VENDEDOR, stock, type Mundo } from './ayudas';

let m: Mundo;
beforeEach(async () => {
  m = await crearMundo();
  darStock(m.db, 1, 1, 50);
  darStock(m.db, 2, 1, 20);
  darStock(m.db, 3, 1, 5);
});

const lineas = (...xs: [number, number][]) => xs.map(([productoId, cantidad]) => ({ productoId, cantidad }));

describe('permisos por rol (matriz)', () => {
  const esperado: Record<Rol, Permiso[]> = {
    administrador: [...PERMISOS],
    vendedor: ['productos.ver', 'existencias.ver', 'pedidos.ver', 'pedidos.crear', 'pedidos.confirmar', 'pedidos.anular', 'clientes.ver', 'clientes.editar', 'reportes.ver', 'sql.consultar'],
    bodeguero: ['productos.ver', 'existencias.ver', 'existencias.ajustar', 'existencias.trasladar', 'pedidos.ver', 'pedidos.despachar', 'compras.ver', 'compras.recibir', 'proveedores.ver', 'reportes.ver', 'auditoria.ver', 'sql.consultar'],
  };
  for (const rol of ['administrador', 'vendedor', 'bodeguero'] as Rol[]) {
    it(`el rol ${rol} tiene exactamente los permisos definidos`, () => {
      const reales = PERMISOS.filter((p) => tienePermiso(rol, p));
      expect(reales.sort()).toEqual([...esperado[rol]].sort());
    });
  }

  it('el vendedor no puede editar productos, ajustar stock ni recibir compras', () => {
    const c = m.ctx('vendedor');
    expect(() => guardarProducto(c, { sku: 'NUEVO-1', nombre: 'x', categoriaId: 1, costo: 1, precio: 2, stockMinimo: 0 })).toThrow(/permiso/);
    expect(() => ajustarStock(c, { productoId: 1, bodegaId: 1, cantidad: 1, motivo: 'conteo' })).toThrow(/permiso/);
    expect(() => trasladarStock(c, { productoId: 1, origenId: 1, destinoId: 2, cantidad: 1 })).toThrow(/permiso/);
    expect(() => recibirOrden(c, 1, [])).toThrow(/permiso/);
  });

  it('el bodeguero no puede crear, confirmar ni anular pedidos, ni gestionar clientes', () => {
    const c = m.ctx('bodeguero');
    expect(() => guardarPedido(c, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 1]) })).toThrow(/permiso/);
    expect(() => confirmarPedido(c, 1)).toThrow(/permiso/);
    expect(() => anularPedido(c, 1)).toThrow(/permiso/);
    expect(() => listarClientes(c)).toThrow(/permiso/);
    expect(() => guardarCliente(c, { nombre: 'x', documento: '1' })).toThrow(/permiso/);
  });

  it('solo el administrador gestiona compras y proveedores; el vendedor no ve compras ni proveedores', () => {
    expect(() => guardarOrden(m.ctx('vendedor'), { proveedorId: 1, bodegaId: 1, lineas: lineas([1, 1]) })).toThrow(/permiso/);
    expect(() => guardarOrden(m.ctx('bodeguero'), { proveedorId: 1, bodegaId: 1, lineas: lineas([1, 1]) })).toThrow(/permiso/);
    expect(() => guardarProveedor(m.ctx('bodeguero'), { nombre: 'x', documento: '9' })).toThrow(/permiso/);
    expect(() => obtenerOrden(m.ctx('vendedor'), 1)).toThrow(/permiso/);
  });

  it('la auditoría de movimientos no es visible para el vendedor', () => {
    expect(() => listarMovimientos(m.ctx('vendedor'))).toThrow(/permiso/);
    expect(listarMovimientos(m.ctx('bodeguero')).total).toBeGreaterThan(0);
  });

  it('un error de permiso tiene código «permiso» y no modifica datos', () => {
    const e = (() => {
      try {
        ajustarStock(m.ctx('vendedor'), { productoId: 1, bodegaId: 1, cantidad: 5, motivo: 'conteo' });
      } catch (x) {
        return x as ErrorDominio;
      }
    })();
    expect(e?.codigo).toBe('permiso');
    expect(stock(m.db, 1, 1)).toBe(50);
  });

  it('un vendedor no puede tocar los pedidos de otro vendedor, el administrador sí', () => {
    const id = guardarPedido(m.ctx('vendedor'), { clienteId: 1, bodegaId: 1, lineas: lineas([1, 2]) });
    const otro = m.ctx(OTRO_VENDEDOR);
    expect(() => confirmarPedido(otro, id)).toThrow(/que tú creaste/);
    expect(() => guardarPedido(otro, { id, clienteId: 1, bodegaId: 1, lineas: lineas([1, 3]) })).toThrow(/que tú creaste/);
    expect(() => eliminarBorrador(otro, id)).toThrow(/que tú creaste/);
    expect(() => anularPedido(otro, id)).toThrow(/que tú creaste/);
    confirmarPedido(m.ctx('administrador'), id);
    expect(obtenerPedido(m.ctx(), id).estado).toBe('confirmado');
  });
});

describe('pedidos de venta: reglas y estados', () => {
  it('crea un borrador con número correlativo y precio tomado del producto', () => {
    const id = guardarPedido(m.ctx('vendedor'), { clienteId: 1, bodegaId: 1, lineas: lineas([1, 4], [2, 2]) });
    const p = obtenerPedido(m.ctx(), id);
    expect(p.numero).toBe('PV-00001');
    expect(p.estado).toBe('borrador');
    expect(p.items.map((i) => [i.sku, i.cantidad, i.precio_unitario])).toEqual([['P-001', 4, 1500], ['P-002', 2, 3000]]);
    expect(p.total).toBe(4 * 1500 + 2 * 3000);
  });

  it('flujo completo: confirmar descuenta, despachar conserva, no se puede anular lo despachado', () => {
    const v = m.ctx('vendedor');
    const id = guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 10]) });
    confirmarPedido(v, id);
    expect(stock(m.db, 1, 1)).toBe(40);
    despacharPedido(m.ctx('bodeguero'), id);
    expect(obtenerPedido(m.ctx(), id).estado).toBe('despachado');
    expect(stock(m.db, 1, 1)).toBe(40);
    expect(() => anularPedido(v, id)).toThrow(/no puede pasar a anulado/);
  });

  it('no se puede despachar un borrador ni confirmar dos veces', () => {
    const v = m.ctx('vendedor');
    const id = guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 1]) });
    expect(() => despacharPedido(m.ctx('bodeguero'), id)).toThrow(/no puede pasar a despachado/);
    confirmarPedido(v, id);
    expect(() => confirmarPedido(v, id)).toThrow(/no puede pasar a confirmado/);
    expect(stock(m.db, 1, 1)).toBe(49);
  });

  it('confirmar sin stock informa los faltantes y no descuenta ninguna línea', () => {
    const v = m.ctx('vendedor');
    const id = guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 10], [3, 6]) });
    let error: ErrorDominio | undefined;
    try {
      confirmarPedido(v, id);
    } catch (e) {
      error = e as ErrorDominio;
    }
    expect(error?.codigo).toBe('stock');
    expect(error?.detalles).toEqual(['P-003: se piden 6 y hay 5']);
    expect(stock(m.db, 1, 1)).toBe(50);
    expect(stock(m.db, 3, 1)).toBe(5);
    expect(obtenerPedido(m.ctx(), id).estado).toBe('borrador');
    expect(faltantesDeStock(m.ctx(), id)).toHaveLength(1);
  });

  it('el stock se valida en la bodega del pedido, no en el total', () => {
    const v = m.ctx('vendedor');
    const id = guardarPedido(v, { clienteId: 1, bodegaId: 2, lineas: lineas([1, 1]) });
    expect(() => confirmarPedido(v, id)).toThrow(/stock suficiente/);
  });

  it('anular un pedido confirmado devuelve el stock y registra el movimiento', () => {
    const v = m.ctx('vendedor');
    const id = guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 10], [2, 5]) });
    confirmarPedido(v, id);
    anularPedido(v, id);
    expect(stock(m.db, 1, 1)).toBe(50);
    expect(stock(m.db, 2, 1)).toBe(20);
    expect(obtenerPedido(m.ctx(), id).estado).toBe('anulado');
  });

  it('valida el borrador: sin líneas, repetidos, cantidades inválidas, cliente inactivo y producto inactivo', () => {
    const v = m.ctx('vendedor');
    expect(() => guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: [] })).toThrow(/al menos un producto/);
    expect(() => guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 1], [1, 2]) })).toThrow(/repetido/);
    expect(() => guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 0]) })).toThrow(/mayor o igual a 1/);
    expect(() => guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: [{ productoId: 1, cantidad: 1.5 }] })).toThrow(/entero/);
    expect(() => guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([4, 1]) })).toThrow(/inactivo/);
    expect(() => guardarPedido(v, { clienteId: 99, bodegaId: 1, lineas: lineas([1, 1]) })).toThrow(/cliente/);
    m.db.run('UPDATE clientes SET activo = 0 WHERE id = 2');
    expect(() => guardarPedido(v, { clienteId: 2, bodegaId: 1, lineas: lineas([1, 1]) })).toThrow(/inactivo/);
    expect(m.db.escalar('SELECT COUNT(*) FROM pedidos')).toBe(0);
  });

  it('editar un borrador reemplaza sus líneas; uno confirmado ya no se edita', () => {
    const v = m.ctx('vendedor');
    const id = guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 1]) });
    guardarPedido(v, { id, clienteId: 2, bodegaId: 1, notas: 'urgente', lineas: lineas([2, 3], [3, 1]) });
    const p = obtenerPedido(m.ctx(), id);
    expect(p.items.map((i) => i.sku)).toEqual(['P-002', 'P-003']);
    expect(p.cliente_id).toBe(2);
    expect(p.notas).toBe('urgente');
    confirmarPedido(v, id);
    expect(() => guardarPedido(v, { id, clienteId: 1, bodegaId: 1, lineas: lineas([1, 1]) })).toThrow(/borrador/);
    expect(() => eliminarBorrador(v, id)).toThrow(/borrador/);
  });

  it('si el reemplazo de líneas falla, el borrador conserva sus líneas originales', () => {
    const v = m.ctx('vendedor');
    const id = guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 1], [2, 2]) });
    expect(() => guardarPedido(v, { id, clienteId: 1, bodegaId: 1, lineas: lineas([1, 5], [4, 1]) })).toThrow(/inactivo/);
    expect(obtenerPedido(m.ctx(), id).items.map((i) => i.cantidad)).toEqual([1, 2]);
  });

  it('filtra la lista por estado y por texto', () => {
    const v = m.ctx('vendedor');
    const a = guardarPedido(v, { clienteId: 1, bodegaId: 1, lineas: lineas([1, 1]) });
    guardarPedido(v, { clienteId: 2, bodegaId: 1, lineas: lineas([1, 1]) });
    confirmarPedido(v, a);
    expect(listarPedidos(v, { estado: 'confirmado' }).map((p) => p.id)).toEqual([a]);
    expect(listarPedidos(v, { q: 'Cliente Dos' })).toHaveLength(1);
    expect(listarPedidos(v, {})).toHaveLength(2);
  });
});

describe('compras: reglas de dominio', () => {
  const nuevaOrden = () => guardarOrden(m.ctx(), { proveedorId: 1, bodegaId: 2, lineas: lineas([1, 100], [2, 50]) });

  it('crea la orden con costo del producto, la envía y recibe parcial y total', () => {
    const id = nuevaOrden();
    expect(obtenerOrden(m.ctx(), id).total).toBe(100 * 1000 + 50 * 2000);
    enviarOrden(m.ctx(), id);
    const [l1, l2] = obtenerOrden(m.ctx(), id).items;
    recibirOrden(m.ctx('bodeguero'), id, [{ lineaId: l1!.id, cantidad: 60 }, { lineaId: l2!.id, cantidad: '' }]);
    let o = obtenerOrden(m.ctx(), id);
    expect(o.estado).toBe('parcial');
    expect(o.unidades_recibidas).toBe(60);
    expect(stock(m.db, 1, 2)).toBe(60);
    recibirOrden(m.ctx('bodeguero'), id, [{ lineaId: l1!.id, cantidad: 40 }, { lineaId: l2!.id, cantidad: 50 }]);
    o = obtenerOrden(m.ctx(), id);
    expect(o.estado).toBe('recibida');
    expect(stock(m.db, 2, 2)).toBe(50);
  });

  it('recibir más de lo pendiente revierte la recepción completa (ninguna línea suma)', () => {
    const id = nuevaOrden();
    enviarOrden(m.ctx(), id);
    const [l1, l2] = obtenerOrden(m.ctx(), id).items;
    expect(() => recibirOrden(m.ctx('bodeguero'), id, [{ lineaId: l1!.id, cantidad: 10 }, { lineaId: l2!.id, cantidad: 51 }])).toThrow(/solo faltan 50/);
    expect(stock(m.db, 1, 2)).toBe(0);
    expect(obtenerOrden(m.ctx(), id).unidades_recibidas).toBe(0);
  });

  it('no se recibe una orden en borrador, anulada o ya recibida, ni con cantidades vacías', () => {
    const id = nuevaOrden();
    const [l1] = obtenerOrden(m.ctx(), id).items;
    expect(() => recibirOrden(m.ctx('bodeguero'), id, [{ lineaId: l1!.id, cantidad: 1 }])).toThrow(/no admite recepciones/);
    enviarOrden(m.ctx(), id);
    expect(() => recibirOrden(m.ctx('bodeguero'), id, [{ lineaId: l1!.id, cantidad: 0 }])).toThrow(/al menos una línea/);
    anularOrden(m.ctx(), id);
    expect(() => recibirOrden(m.ctx('bodeguero'), id, [{ lineaId: l1!.id, cantidad: 1 }])).toThrow(/no admite recepciones/);
  });

  it('no se anula una orden con recepciones parciales', () => {
    const id = nuevaOrden();
    enviarOrden(m.ctx(), id);
    const [l1] = obtenerOrden(m.ctx(), id).items;
    recibirOrden(m.ctx('bodeguero'), id, [{ lineaId: l1!.id, cantidad: 1 }]);
    expect(() => anularOrden(m.ctx(), id)).toThrow(/parcial no se puede anular/);
  });

  it('una línea de otra orden se rechaza al recibir', () => {
    const a = nuevaOrden();
    const b = guardarOrden(m.ctx(), { proveedorId: 2, bodegaId: 1, lineas: lineas([3, 5]) });
    enviarOrden(m.ctx(), a);
    enviarOrden(m.ctx(), b);
    const lineaB = obtenerOrden(m.ctx(), b).items[0]!;
    expect(() => recibirOrden(m.ctx('bodeguero'), a, [{ lineaId: lineaB.id, cantidad: 1 }])).toThrow(/no pertenece/);
  });
});

describe('inventario: ajustes y traslados', () => {
  it('traslada entre bodegas con mensajes claros cuando falta stock', () => {
    const b = m.ctx('bodeguero');
    trasladarStock(b, { productoId: 1, origenId: 1, destinoId: 3, cantidad: 20, nota: 'reparto' });
    expect(stock(m.db, 1, 1)).toBe(30);
    expect(stock(m.db, 1, 3)).toBe(20);
    expect(() => trasladarStock(b, { productoId: 1, origenId: 1, destinoId: 3, cantidad: 31 })).toThrow(/hay 30 y se piden 31/);
    expect(() => trasladarStock(b, { productoId: 1, origenId: 1, destinoId: 1, cantidad: 1 })).toThrow(/distintas/);
    expect(() => trasladarStock(b, { productoId: 1, origenId: 1, destinoId: 2, cantidad: 0 })).toThrow(/mayor o igual a 1/);
  });

  it('ajusta con motivo, rechaza cero, negativos que exceden y productos inactivos', () => {
    const b = m.ctx('bodeguero');
    ajustarStock(b, { productoId: 3, bodegaId: 1, cantidad: -2, motivo: 'daño' });
    expect(stock(m.db, 3, 1)).toBe(3);
    expect(() => ajustarStock(b, { productoId: 3, bodegaId: 1, cantidad: -4, motivo: 'merma' })).toThrow(/Stock insuficiente/);
    expect(() => ajustarStock(b, { productoId: 3, bodegaId: 1, cantidad: 0, motivo: 'merma' })).toThrow(/cero/);
    expect(() => ajustarStock(b, { productoId: 3, bodegaId: 1, cantidad: 1, motivo: 'robo' })).toThrow(/motivo/);
    expect(() => ajustarStock(b, { productoId: 4, bodegaId: 1, cantidad: 1, motivo: 'conteo' })).toThrow(/inactivo/);
    expect(stock(m.db, 3, 1)).toBe(3);
  });

  it('la matriz de existencias reparte por bodega y marca el total', () => {
    trasladarStock(m.ctx('bodeguero'), { productoId: 2, origenId: 1, destinoId: 2, cantidad: 5 });
    const { bodegas, filas } = matrizExistencias(m.ctx());
    expect(bodegas.map((b) => b.codigo)).toEqual(['BOG', 'MED', 'CAL']);
    const p2 = filas.find((f) => f.sku === 'P-002')!;
    expect(p2.por_bodega).toEqual({ BOG: 15, MED: 5 });
    expect(p2.stock_total).toBe(20);
    expect(matrizExistencias(m.ctx(), { soloBajo: true }).filas.map((f) => f.sku)).toContain('P-005');
  });

  it('la auditoría pagina y filtra por tipo, texto y fechas', () => {
    trasladarStock(m.ctx('bodeguero'), { productoId: 1, origenId: 1, destinoId: 2, cantidad: 1 });
    const todos = listarMovimientos(m.ctx(), { porPagina: 2, pagina: 1 });
    expect(todos.filas).toHaveLength(2);
    expect(todos.total).toBe(5);
    expect(listarMovimientos(m.ctx(), { tipo: 'traslado_entrada' }).total).toBe(1);
    expect(listarMovimientos(m.ctx(), { q: 'P-003' }).total).toBe(1);
    expect(listarMovimientos(m.ctx(), { desde: '2026-11-06', hasta: '2026-11-06' }).total).toBe(2);
    expect(listarMovimientos(m.ctx(), { desde: '2030-01-01' }).total).toBe(0);
  });
});

describe('catálogo: productos, clientes y bajas lógicas', () => {
  const base = { sku: 'nuevo-01', nombre: 'Producto nuevo', categoriaId: 1, costo: '1000', precio: '1800', stockMinimo: '3' };

  it('crea normalizando el SKU a mayúsculas y lo recupera', () => {
    const id = guardarProducto(m.ctx(), base);
    const p = obtenerProducto(m.ctx(), id);
    expect(p.sku).toBe('NUEVO-01');
    expect(p.precio).toBe(1800);
    expect(p.stock_total).toBe(0);
  });

  it('valida SKU, precio menor al costo, números y duplicados con mensajes comprensibles', () => {
    expect(mensajeDe(() => guardarProducto(m.ctx(), { ...base, sku: 'a b' }))).toMatch(/solo admite letras/);
    expect(mensajeDe(() => guardarProducto(m.ctx(), { ...base, precio: 500 }))).toMatch(/menor al costo/);
    expect(mensajeDe(() => guardarProducto(m.ctx(), { ...base, costo: 'abc' }))).toMatch(/entero/);
    expect(mensajeDe(() => guardarProducto(m.ctx(), { ...base, costo: -5 }))).toMatch(/mayor o igual a 0/);
    expect(mensajeDe(() => guardarProducto(m.ctx(), { ...base, nombre: '   ' }))).toMatch(/obligatorio/);
    expect(mensajeDe(() => guardarProducto(m.ctx(), { ...base, categoriaId: 99 }))).toMatch(/categoría/);
    expect(mensajeDe(() => guardarProducto(m.ctx(), { ...base, sku: 'p-001' }))).toMatch(/Ya existe un producto con ese SKU/);
  });

  it('elimina un producto sin historial y desactiva uno con historial', () => {
    const libre = guardarProducto(m.ctx(), base);
    expect(eliminarProducto(m.ctx(), libre)).toBe('eliminado');
    expect(listarProductos(m.ctx(), { q: 'NUEVO-01' })).toHaveLength(0);
    expect(eliminarProducto(m.ctx(), 1)).toBe('desactivado');
    expect(obtenerProducto(m.ctx(), 1).activo).toBe(0);
    expect(stock(m.db, 1, 1)).toBe(50);
  });

  it('filtra por categoría, estado y stock bajo, y ordena', () => {
    expect(listarProductos(m.ctx(), { categoriaId: 2 }).map((p) => p.sku)).toEqual(['P-003', 'P-004', 'P-005']);
    expect(listarProductos(m.ctx(), { estado: 'inactivos' }).map((p) => p.sku)).toEqual(['P-004']);
    expect(listarProductos(m.ctx(), { estado: 'bajo' }).map((p) => p.sku)).toEqual(['P-005']);
    expect(listarProductos(m.ctx(), { orden: 'precio', descendente: true })[0]!.sku).toBe('P-004');
    expect(listarProductos(m.ctx(), { orden: 'stock' })[0]!.stock_total).toBe(0);
  });

  it('clientes: valida correo y teléfono, evita documentos repetidos y da de baja lógica', () => {
    expect(mensajeDe(() => guardarCliente(m.ctx('vendedor'), { nombre: 'X', documento: '5', email: 'sin-arroba' }))).toMatch(/correo/);
    expect(mensajeDe(() => guardarCliente(m.ctx('vendedor'), { nombre: 'X', documento: '5', telefono: 'abc' }))).toMatch(/teléfono/);
    expect(mensajeDe(() => guardarCliente(m.ctx('vendedor'), { nombre: 'X', documento: '900' }))).toMatch(/Ya existe un cliente/);
    const id = guardarCliente(m.ctx('vendedor'), { nombre: 'Cliente Nuevo', documento: '777', email: 'a@b.co', telefono: '300 123 4567' });
    expect(eliminarCliente(m.ctx('vendedor'), id)).toBe('eliminado');
    guardarPedido(m.ctx('vendedor'), { clienteId: 1, bodegaId: 1, lineas: lineas([1, 1]) });
    expect(eliminarCliente(m.ctx('vendedor'), 1)).toBe('desactivado');
    expect(listarClientes(m.ctx('vendedor')).find((c) => c.id === 1)?.activo).toBe(0);
  });
});

describe('seguridad: SQL parametrizado ante entradas hostiles', () => {
  const hostil = "x'; DROP TABLE productos; --";

  it('una búsqueda con comillas no inyecta SQL y devuelve vacío', () => {
    expect(listarProductos(m.ctx(), { q: hostil })).toEqual([]);
    expect(listarProductos(m.ctx(), { q: "' OR '1'='1" })).toEqual([]);
    expect(m.db.escalar('SELECT COUNT(*) FROM productos')).toBe(5);
  });

  it('un nombre con comillas, punto y coma y HTML se guarda literal', () => {
    const nombre = `Tornillo 1/4" O'Neil; DELETE FROM productos; -- <b>x</b>`;
    const id = guardarProducto(m.ctx(), { sku: 'INY-1', nombre, categoriaId: 1, costo: 1, precio: 2, stockMinimo: 0 });
    expect(obtenerProducto(m.ctx(), id).nombre).toBe(nombre);
    expect(m.db.escalar('SELECT COUNT(*) FROM productos')).toBe(6);
  });

  it('los comodines % y _ de la búsqueda se tratan como texto literal', () => {
    expect(listarProductos(m.ctx(), { q: '%' })).toEqual([]);
    expect(listarProductos(m.ctx(), { q: 'P_001' })).toEqual([]);
    expect(listarProductos(m.ctx(), { q: 'P-001' })).toHaveLength(1);
  });

  it('filtros de clientes, pedidos y movimientos con comillas tampoco rompen la consulta', () => {
    expect(listarClientes(m.ctx(), hostil)).toEqual([]);
    expect(listarPedidos(m.ctx(), { q: hostil })).toEqual([]);
    expect(listarMovimientos(m.ctx(), { q: hostil, tipo: hostil }).total).toBe(0);
    expect(m.db.escalar('SELECT COUNT(*) FROM clientes')).toBe(2);
  });
});

describe('consola SQL de solo lectura', () => {
  it('ejecuta SELECT y devuelve columnas y filas', () => {
    const r = ejecutarConsulta(m.ctx('vendedor'), 'SELECT sku, stock_total FROM v_stock_producto WHERE producto_id = 1');
    expect(r.columnas).toEqual(['sku', 'stock_total']);
    expect(r.filas).toEqual([['P-001', 50]]);
    expect(r.truncado).toBe(false);
  });

  it('acepta WITH, EXPLAIN y PRAGMA table_info; ignora ; final y comentarios', () => {
    expect(ejecutarConsulta(m.ctx(), 'WITH x AS (SELECT 1 AS a) SELECT a FROM x;').filas).toEqual([[1]]);
    expect(ejecutarConsulta(m.ctx(), '-- hola\nSELECT 2 /* c */').filas).toEqual([[2]]);
    expect(ejecutarConsulta(m.ctx(), 'PRAGMA table_info(productos)').filas.length).toBeGreaterThan(5);
    expect(ejecutarConsulta(m.ctx(), 'EXPLAIN QUERY PLAN SELECT * FROM productos').columnas.length).toBeGreaterThan(0);
  });

  it('rechaza escrituras y DDL sin modificar los datos', () => {
    for (const sql of [
      'DELETE FROM productos',
      "UPDATE productos SET precio = 1 WHERE id = 1",
      'DROP TABLE productos',
      "INSERT INTO categorias (nombre) VALUES ('x')",
      'CREATE TABLE x (a)',
      'PRAGMA foreign_keys = OFF',
    ]) {
      expect(() => ejecutarConsulta(m.ctx(), sql), sql).toThrow(ErrorDominio);
    }
    expect(m.db.escalar('SELECT COUNT(*) FROM productos')).toBe(5);
    expect(m.db.escalar('PRAGMA foreign_keys')).toBe(1);
  });

  it('rechaza varias sentencias, aunque la primera sea un SELECT', () => {
    expect(() => ejecutarConsulta(m.ctx(), 'SELECT 1; DROP TABLE productos')).toThrow(/una sentencia/);
    expect(() => ejecutarConsulta(m.ctx(), "SELECT 1; DELETE FROM productos")).toThrow(/una sentencia/);
    expect(m.db.escalar('SELECT COUNT(*) FROM productos')).toBe(5);
  });

  it('un punto y coma dentro de un literal no cuenta como segunda sentencia', () => {
    expect(ejecutarConsulta(m.ctx(), "SELECT 'a;b' AS t").filas).toEqual([['a;b']]);
  });

  it('el motor impide escribir incluso si una sentencia disfrazada pasara el filtro', () => {
    // WITH ... DELETE no es SELECT puro: el pragma query_only del motor lo detiene.
    expect(() => ejecutarConsulta(m.ctx(), 'WITH x AS (SELECT 1) DELETE FROM productos')).toThrow(ErrorDominio);
    expect(m.db.escalar('SELECT COUNT(*) FROM productos')).toBe(5);
    // y el modo de escritura se restablece después
    expect(() => m.db.run("INSERT INTO categorias (nombre) VALUES ('ok')")).not.toThrow();
  });

  it('limita a 500 filas e informa que truncó; reporta errores de sintaxis', () => {
    const r = ejecutarConsulta(m.ctx(), 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 800) SELECT i FROM n');
    expect(r.filas).toHaveLength(500);
    expect(r.truncado).toBe(true);
    expect(() => ejecutarConsulta(m.ctx(), 'SELECT FROM')).toThrow(/SQL:/);
    expect(() => ejecutarConsulta(m.ctx(), '   ')).toThrow(/SELECT/);
  });

  it('lista el esquema con tablas, vistas, triggers e índices', () => {
    const e = leerEsquema(m.ctx());
    const tipos = new Set(e.map((o) => o.tipo));
    expect(tipos).toEqual(new Set(['table', 'view', 'trigger', 'index']));
    const productos = e.find((o) => o.nombre === 'productos')!;
    expect(productos.columnas.find((c) => c.nombre === 'id')?.pk).toBe(true);
    expect(e.filter((o) => o.tipo === 'trigger').length).toBeGreaterThanOrEqual(25);
  });
});
