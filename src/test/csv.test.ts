import { beforeEach, describe, expect, it } from 'vitest';
import { escribirCsv, leerCsv } from '../domain/csv';
import { ErrorDominio } from '../domain/nucleo';
import { exportarProductosCsv, importarProductosCsv, listarProductos } from '../domain/catalogo';
import { crearMundo, type Mundo } from './ayudas';

let m: Mundo;
beforeEach(async () => {
  m = await crearMundo();
});

const ENC = 'sku,nombre,categoria,proveedor,unidad,costo,precio,stock_minimo,activo';

describe('lector CSV', () => {
  it('lee celdas simples, comillas, comillas escapadas y saltos dentro de celdas', () => {
    const filas = leerCsv('a,b,c\r\n1,"dos, con coma","tres ""citado"""\r\n"x\ny",,z\r\n');
    expect(filas).toEqual([['a', 'b', 'c'], ['1', 'dos, con coma', 'tres "citado"'], ['x\ny', '', 'z']]);
  });
  it('detecta punto y coma como separador y quita el BOM', () => {
    expect(leerCsv('﻿a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('ignora líneas en blanco', () => {
    expect(leerCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('rechaza archivo vacío', () => {
    expect(() => leerCsv('  \n ')).toThrow(/vacío/);
  });
  it('rechaza comilla sin cerrar indicando la línea', () => {
    expect(() => leerCsv('a,b\n1,"abierta\n2,3')).toThrow(/Comilla sin cerrar abierta en la línea 2/);
  });
  it('rechaza comilla en medio de una celda sin entrecomillar', () => {
    expect(() => leerCsv('a,b\n1,ab"c')).toThrow(/comilla inesperada/);
  });
  it('rechaza filas con distinto número de columnas', () => {
    expect(() => leerCsv('a,b,c\n1,2')).toThrow(/La fila 2 tiene 2 columnas/);
  });
});

describe('escritor CSV', () => {
  it('entrecomilla lo necesario y duplica comillas', () => {
    expect(escribirCsv(['a', 'b'], [['x,y', 'dijo "hola"'], [1, null]])).toBe('a,b\r\n"x,y","dijo ""hola"""\r\n1,\r\n');
  });
  it('neutraliza fórmulas que Excel ejecutaría, pero no números negativos', () => {
    const csv = escribirCsv(['v'], [['=HYPERLINK("x")'], ['+cmd'], ['@sum'], ['-5'], [-7]]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'@sum");
    expect(csv.split('\r\n')).toContain('-5');
    expect(csv.split('\r\n')).toContain('-7');
  });
  it('lo exportado se puede leer de nuevo sin pérdida', () => {
    const filas = [['a"b', 'c,d', 'e\nf']];
    expect(leerCsv(escribirCsv(['x', 'y', 'z'], filas)).slice(1)).toEqual(filas);
  });
});

describe('importación de productos', () => {
  it('crea productos nuevos, categorías nuevas y actualiza por SKU existente', () => {
    const r = importarProductosCsv(
      m.ctx(),
      `${ENC}\nN-001,Nuevo uno,Cat Nueva,Proveedor Uno,und,1000,1500,4,si\np-001,Producto uno renombrado,Cat A,,und,1000,1600,5,si\n`,
    );
    expect(r).toEqual({ creados: 1, actualizados: 1 });
    const todos = listarProductos(m.ctx());
    expect(todos.find((p) => p.sku === 'N-001')?.categoria).toBe('Cat Nueva');
    expect(todos.find((p) => p.sku === 'P-001')).toMatchObject({ nombre: 'Producto uno renombrado', precio: 1600 });
  });

  it('es todo o nada: con una fila inválida no se guarda ninguna y se informan todos los errores', () => {
    const antes = listarProductos(m.ctx()).length;
    let error: ErrorDominio | undefined;
    try {
      importarProductosCsv(
        m.ctx(),
        `${ENC}\nOK-001,Bueno,Cat A,,und,100,200,1,si\nBAD 1,Sku inválido,Cat A,,und,100,200,1,si\nOK-002,Precio bajo,Cat A,,und,500,100,1,si\nOK-003,Proveedor raro,Cat A,Nadie S.A.,und,1,2,1,si\n`,
      );
    } catch (e) {
      error = e as ErrorDominio;
    }
    expect(error?.message).toMatch(/No se importó nada/);
    expect(error?.detalles).toHaveLength(3);
    expect(error?.detalles[0]).toMatch(/^Fila 3:.*SKU/);
    expect(error?.detalles[1]).toMatch(/^Fila 4:.*menor al costo/);
    expect(error?.detalles[2]).toMatch(/^Fila 5:.*proveedor/i);
    expect(listarProductos(m.ctx())).toHaveLength(antes);
  });

  it('no deja categorías creadas a medias cuando la importación falla', () => {
    expect(() => importarProductosCsv(m.ctx(), `${ENC}\nZ-001,Algo,Categoría fantasma,,und,x,2,1,si\n`)).toThrow(ErrorDominio);
    expect(m.db.escalar("SELECT COUNT(*) FROM categorias WHERE nombre = 'Categoría fantasma'")).toBe(0);
  });

  it('rechaza CSV malformado, sin columnas obligatorias o solo con encabezado', () => {
    expect(() => importarProductosCsv(m.ctx(), `${ENC}\nA-1,"sin cerrar,Cat A,,und,1,2,1,si`)).toThrow(/Comilla sin cerrar/);
    expect(() => importarProductosCsv(m.ctx(), `${ENC}\nA-1,Corta,Cat A`)).toThrow(/columnas/);
    expect(() => importarProductosCsv(m.ctx(), 'sku,nombre\nA-1,x')).toThrow(/Faltan columnas obligatorias: categoria, costo, precio/);
    expect(() => importarProductosCsv(m.ctx(), ENC)).toThrow(/solo tiene encabezado/);
    expect(() => importarProductosCsv(m.ctx(), '')).toThrow(/vacío/);
  });

  it('acepta el separador punto y coma y valores con comillas y comas', () => {
    importarProductosCsv(m.ctx(), 'sku;nombre;categoria;costo;precio\nQ-1;"Tubo 1/2"", gris";Cat A;100;200');
    expect(listarProductos(m.ctx(), { q: 'Q-1' })[0]?.nombre).toBe('Tubo 1/2", gris');
  });

  it('un nombre con intento de inyección SQL o fórmula se guarda como texto', () => {
    importarProductosCsv(m.ctx(), `${ENC}\nI-1,"x'); DROP TABLE productos;--",Cat A,,und,1,2,0,si\nI-2,=cmd|' /C calc'!A0,Cat A,,und,1,2,0,si\n`);
    expect(m.db.escalar('SELECT COUNT(*) FROM productos')).toBe(7);
    expect(listarProductos(m.ctx(), { q: 'I-2' })[0]?.nombre).toBe("=cmd|' /C calc'!A0");
  });

  it('solo el administrador importa', () => {
    expect(() => importarProductosCsv(m.ctx('vendedor'), `${ENC}\nA-1,x,Cat A,,und,1,2,0,si`)).toThrow(/permiso/);
    expect(() => importarProductosCsv(m.ctx('bodeguero'), `${ENC}\nA-1,x,Cat A,,und,1,2,0,si`)).toThrow(/permiso/);
  });

  it('exporta e importa de ida y vuelta sin cambios', () => {
    const csv = exportarProductosCsv(m.ctx());
    expect(csv.split('\r\n')[0]).toBe(ENC);
    const antes = listarProductos(m.ctx());
    expect(importarProductosCsv(m.ctx(), csv)).toEqual({ creados: 0, actualizados: antes.length });
    expect(listarProductos(m.ctx())).toEqual(antes);
  });
});
