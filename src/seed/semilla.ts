import type { Db } from '../data/db';
import type { Contexto, Usuario } from '../domain/nucleo';
import { sumarDias } from '../domain/nucleo';
import { ajustarStock, trasladarStock } from '../domain/inventario';
import { anularPedido, confirmarPedido, despacharPedido, guardarPedido } from '../domain/pedidos';
import { enviarOrden, guardarOrden, obtenerOrden, recibirOrden } from '../domain/compras';
import { BODEGAS, CATEGORIAS, CLIENTES, PRODUCTOS_POR_CATEGORIA, PROVEEDORES, ROLES, USUARIOS } from './catalogo-demo';

/** PRNG determinista (mulberry32): la misma semilla produce siempre los mismos datos. */
export function crearAzar(semilla: number) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    siguiente,
    entre: (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1)),
    elegir: <T,>(xs: readonly T[]): T => xs[Math.floor(siguiente() * xs.length)]!,
  };
}

export interface ResumenSemilla {
  productos: number; clientes: number; proveedores: number; pedidos: number; ordenes: number; movimientos: number;
}

export const SEMILLA_DEMO = 20240607;
const DIAS_HISTORIA = 120;
const TOTAL_PEDIDOS = 150;

function roles(rol: number): Usuario['rol'] {
  return (['administrador', 'vendedor', 'bodeguero'] as const)[rol - 1]!;
}

export function usuariosDemo(): Usuario[] {
  return USUARIOS.map((u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: roles(u.rol_id) }));
}

/**
 * Siembra datos maestros y un historial de 120 días relativo a `hoy`.
 * Todo el historial pasa por los servicios del dominio, de modo que los
 * triggers generan existencias y movimientos igual que en el uso real.
 */
export function sembrar(db: Db, hoy: Date, semilla = SEMILLA_DEMO): ResumenSemilla {
  const azar = crearAzar(semilla);
  const usuarios = usuariosDemo();
  const porId = (id: number) => usuarios.find((u) => u.id === id)!;
  let reloj = new Date(hoy);
  const ctxDe = (u: Usuario): Contexto => ({ db, usuario: u, ahora: () => reloj });
  const en = (dia: number, hora: number, minuto = 0) => {
    const d = sumarDias(hoy, dia);
    d.setHours(hora, minuto, 0, 0);
    return d > hoy ? new Date(hoy) : d;
  };

  // ---- datos maestros (inserción directa: aún no hay documentos que auditar) ----
  db.transaccion(() => {
    for (const r of ROLES) db.run('INSERT INTO roles (id, nombre, descripcion) VALUES (?,?,?)', [r.id, r.nombre, r.descripcion]);
    for (const u of USUARIOS) db.run('INSERT INTO usuarios (id, nombre, email, rol_id) VALUES (?,?,?,?)', [u.id, u.nombre, u.email, u.rol_id]);
    for (const b of BODEGAS) db.run('INSERT INTO bodegas (id, codigo, nombre, ciudad) VALUES (?,?,?,?)', [b.id, b.codigo, b.nombre, b.ciudad]);
    CATEGORIAS.forEach((c, i) => db.run('INSERT INTO categorias (id, nombre, descripcion) VALUES (?,?,?)', [i + 1, c.nombre, c.descripcion]));
    PROVEEDORES.forEach(([nombre, nit, contacto, ciudad], i) => {
      const slug = nombre.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 14);
      db.run('INSERT INTO proveedores (id, nombre, nit, contacto, email, telefono, ciudad) VALUES (?,?,?,?,?,?,?)', [
        i + 1, nombre, nit, contacto, `ventas@${slug}.example`, `60${azar.entre(1, 8)} ${azar.entre(200, 899)} ${azar.entre(1000, 9999)}`, ciudad,
      ]);
    });
    CLIENTES.forEach(([nombre, documento, ciudad], i) => {
      const slug = nombre.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '').slice(0, 14);
      db.run('INSERT INTO clientes (id, nombre, documento, email, telefono, ciudad) VALUES (?,?,?,?,?,?)', [
        i + 1, nombre, documento, `compras@${slug}.example`, `3${azar.entre(0, 2)}${azar.entre(0, 9)} ${azar.entre(200, 899)} ${azar.entre(1000, 9999)}`, ciudad,
      ]);
    });
    let n = 0;
    CATEGORIAS.forEach((cat, ci) => {
      (PRODUCTOS_POR_CATEGORIA[cat.prefijo] ?? []).forEach(([nombre, unidad, costo], j) => {
        n++;
        const margen = 1.22 + azar.siguiente() * 0.36;
        const precio = Math.max(costo + 100, Math.round((costo * margen) / 50) * 50);
        const minimo = costo > 60000 ? azar.entre(4, 10) : costo > 15000 ? azar.entre(10, 25) : azar.entre(25, 70);
        const creado = sumarDias(hoy, -DIAS_HISTORIA - 5);
        db.run(
          `INSERT INTO productos (id, sku, nombre, categoria_id, proveedor_id, unidad, costo, precio, stock_minimo, creado_en)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [n, `${cat.prefijo}-${1000 + n}`, nombre, ci + 1, ((ci * 3 + (j % 3)) % 12) + 1, unidad, costo, precio, minimo, creado.toISOString().slice(0, 19).replace('T', ' ')],
        );
      });
    });
  });

  const productos = db.all<{ id: number; proveedor_id: number; stock_minimo: number; costo: number; precio: number }>(
    'SELECT id, proveedor_id, stock_minimo, costo, precio FROM productos ORDER BY id',
  );
  const admin = porId(1);
  const bodeguero = porId(4);
  const vendedores = [porId(2), porId(3)];

  // ---- compra inicial: una orden por proveedor, recibida completa en Bogotá ----
  const compraYRecibe = (
    proveedorId: number,
    lineas: { productoId: number; cantidad: number }[],
    diaCrear: number,
    diaRecibir: number | null,
    parcial = false,
    enviar = true,
  ): number => {
    reloj = en(diaCrear, 9, azar.entre(0, 50));
    const id = guardarOrden(ctxDe(admin), { proveedorId, bodegaId: 1, notas: '', lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad })) });
    if (!enviar) return id;
    reloj = en(diaCrear, 10, 15);
    enviarOrden(ctxDe(admin), id);
    if (diaRecibir !== null) {
      reloj = en(diaRecibir, 11, azar.entre(0, 50));
      const orden = obtenerOrden(ctxDe(admin), id);
      const recibidos = orden.items.map((l, i) => ({
        lineaId: l.id,
        cantidad: parcial ? (i % 2 === 0 ? Math.floor(l.pendiente / 2) : 0) : l.pendiente,
      }));
      recibirOrden(ctxDe(bodeguero), id, recibidos);
    }
    return id;
  };

  const lineasIniciales = (provId: number) =>
    productos
      .filter((p) => p.proveedor_id === provId)
      .map((p) => ({ productoId: p.id, cantidad: p.stock_minimo * azar.entre(5, 9) + azar.entre(0, 30) }));

  let ordenes = 0;
  for (let prov = 1; prov <= 12; prov++) {
    compraYRecibe(prov, lineasIniciales(prov), -DIAS_HISTORIA, -DIAS_HISTORIA + 2);
    ordenes++;
  }
  // Reparto inicial a Medellín y Cali.
  for (const p of productos) {
    reloj = en(-DIAS_HISTORIA + 4, 8, azar.entre(0, 50));
    const total = db.escalar('SELECT COALESCE(SUM(cantidad),0) FROM existencias WHERE producto_id = ?', [p.id]);
    const mover = (destino: number, fraccion: number) =>
      trasladarStock(ctxDe(bodeguero), { productoId: p.id, origenId: 1, destinoId: destino, cantidad: Math.max(1, Math.floor(total * fraccion)), nota: 'Reparto inicial' });
    mover(2, 0.25);
    mover(3, 0.2);
  }

  // ---- ventas: 150 pedidos repartidos en 120 días (más densos hacia hoy) ----
  const dias: number[] = [];
  while (dias.length < TOTAL_PEDIDOS) {
    const x = Math.pow(azar.siguiente(), 0.75);
    dias.push(-Math.min(DIAS_HISTORIA - 6, Math.floor((1 - x) * (DIAS_HISTORIA - 6))));
  }
  dias.sort((a, b) => a - b);

  // Productos «lentos» para que algunos terminen bajo el mínimo y otros casi no roten.
  const pesos = productos.map((_, i) => (i % 7 === 3 ? 0.35 : 1 + (i % 5) * 0.4));
  const total = pesos.reduce((a, b) => a + b, 0);
  const elegirProducto = () => {
    let r = azar.siguiente() * total;
    for (let i = 0; i < pesos.length; i++) {
      r -= pesos[i]!;
      if (r <= 0) return productos[i]!;
    }
    return productos[0]!;
  };

  let pedidos = 0;
  let proximaReposicion = -DIAS_HISTORIA + 14;
  for (const dia of dias) {
    // Reposición periódica (cada ~2 semanas) de lo que ande bajo; algunos productos se dejan sin reponer.
    while (proximaReposicion <= dia) {
      const baja = productos.filter((p, i) => {
        if (i % 9 === 4 && proximaReposicion > -45) return false;
        const t = db.escalar('SELECT COALESCE(SUM(cantidad),0) FROM existencias WHERE producto_id = ?', [p.id]);
        return t < p.stock_minimo * 3;
      });
      const porProv = new Map<number, { productoId: number; cantidad: number }[]>();
      for (const p of baja) {
        const l = porProv.get(p.proveedor_id) ?? [];
        l.push({ productoId: p.id, cantidad: p.stock_minimo * azar.entre(4, 7) });
        porProv.set(p.proveedor_id, l);
      }
      for (const [prov, lineas] of porProv) {
        const recibe = Math.min(proximaReposicion + azar.entre(2, 4), 0);
        compraYRecibe(prov, lineas, proximaReposicion, recibe, azar.siguiente() < 0.2);
        ordenes++;
      }
      proximaReposicion += 14;
    }

    // Pedido de venta
    const vendedor = azar.elegir(vendedores);
    const bodegaId = azar.siguiente() < 0.55 ? 1 : azar.siguiente() < 0.55 ? 2 : 3;
    const lineas: { productoId: number; cantidad: number }[] = [];
    const n = azar.entre(1, 5);
    for (let k = 0; k < n; k++) {
      const p = elegirProducto();
      if (lineas.some((l) => l.productoId === p.id)) continue;
      const disp = db.escalar('SELECT COALESCE((SELECT cantidad FROM existencias WHERE producto_id = ? AND bodega_id = ?),0)', [p.id, bodegaId]);
      const deseada = p.costo > 60000 ? azar.entre(1, 3) : p.costo > 15000 ? azar.entre(1, 8) : azar.entre(2, 24);
      const cantidad = Math.min(deseada, disp);
      if (cantidad > 0) lineas.push({ productoId: p.id, cantidad });
    }
    if (!lineas.length) continue;

    reloj = en(dia, azar.entre(8, 16), azar.entre(0, 59));
    const ctxV = ctxDe(vendedor);
    const id = guardarPedido(ctxV, { clienteId: azar.entre(1, CLIENTES.length), bodegaId, lineas });
    const edad = -dia;
    const suerte = azar.siguiente();
    if (edad <= 1 && suerte < 0.4) {
      pedidos++;
      continue; // borrador reciente
    }
    reloj = new Date(reloj.getTime() + 3_600_000);
    if (reloj > hoy) reloj = new Date(hoy);
    confirmarPedido(ctxV, id);
    if (edad > 3 && suerte > 0.93) {
      reloj = new Date(Math.min(reloj.getTime() + 86_400_000, hoy.getTime()));
      anularPedido(ctxV, id);
    } else if (edad > 3 || (edad > 1 && suerte < 0.45)) {
      reloj = new Date(Math.min(reloj.getTime() + 86_400_000 * azar.entre(0, 1) + 7_200_000, hoy.getTime()));
      despacharPedido(ctxDe(azar.siguiente() < 0.5 ? bodeguero : porId(5)), id);
    }
    pedidos++;
  }

  // ---- compras en curso: enviada, parcial, borrador y anulada ----
  const lineasDe = (prov: number, cuantos: number) =>
    productos.filter((p) => p.proveedor_id === prov).slice(0, cuantos).map((p) => ({ productoId: p.id, cantidad: p.stock_minimo * 3 }));
  compraYRecibe(3, lineasDe(3, 3), -4, null);
  compraYRecibe(6, lineasDe(6, 4), -6, null);
  compraYRecibe(5, lineasDe(5, 4), -9, -2, true);
  reloj = en(-1, 15);
  compraYRecibe(8, lineasDe(8, 3), -1, null, false, false);
  reloj = en(-12, 9);
  const anulada = guardarOrden(ctxDe(admin), { proveedorId: 11, bodegaId: 1, notas: 'Cotización cancelada por precio', lineas: lineasDe(11, 2) });
  reloj = en(-11, 9);
  db.run("UPDATE ordenes_compra SET estado = 'anulada' WHERE id = ?", [anulada]);
  ordenes += 5;

  // ---- ajustes de inventario: mermas y conteos que dejan algunos productos bajo el mínimo ----
  reloj = en(-1, 17);
  let marcados = 0;
  productos.forEach((p, i) => {
    if (i % 10 !== 6 || marcados >= 7) return;
    const stock = db.escalar('SELECT COALESCE(SUM(cantidad),0) FROM existencias WHERE producto_id = ?', [p.id]);
    const objetivo = marcados % 3 === 0 ? 0 : Math.max(1, Math.floor(p.stock_minimo * 0.4));
    if (stock <= objetivo) return;
    let restante = stock - objetivo;
    for (const bodegaId of [1, 2, 3]) {
      const aqui = db.escalar('SELECT COALESCE((SELECT cantidad FROM existencias WHERE producto_id = ? AND bodega_id = ?),0)', [p.id, bodegaId]);
      const quitar = Math.min(aqui, restante);
      if (quitar > 0) {
        ajustarStock(ctxDe(bodeguero), { productoId: p.id, bodegaId, cantidad: -quitar, motivo: marcados % 2 ? 'merma' : 'conteo', nota: 'Conteo cíclico del mes' });
        restante -= quitar;
      }
    }
    marcados++;
  });

  return {
    productos: productos.length,
    clientes: CLIENTES.length,
    proveedores: PROVEEDORES.length,
    pedidos,
    ordenes,
    movimientos: db.escalar('SELECT COUNT(*) FROM movimientos'),
  };
}
