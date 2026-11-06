import { ErrorDominio } from './nucleo';

/**
 * Lector CSV mínimo pero estricto: comillas dobles, saltos de línea dentro de
 * celdas, BOM, separador coma o punto y coma. Lanza ErrorDominio si el
 * archivo está malformado (comilla sin cerrar, filas con distinto ancho).
 */
export function leerCsv(entrada: string): string[][] {
  const texto = entrada.replace(/^﻿/, '');
  if (!texto.trim()) throw new ErrorDominio('El archivo CSV está vacío.');
  const primera = texto.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';

  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;
  let abiertaEn = 0;
  let linea = 1;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        if (c === '\n') linea++;
        celda += c;
      }
    } else if (c === '"') {
      if (celda !== '') throw new ErrorDominio(`Línea ${linea}: comilla inesperada dentro de una celda sin entrecomillar.`);
      entreComillas = true;
      abiertaEn = linea;
    } else if (c === sep) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda);
      celda = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
      linea++;
    } else {
      celda += c;
    }
  }
  if (entreComillas) throw new ErrorDominio(`Comilla sin cerrar abierta en la línea ${abiertaEn}.`);
  fila.push(celda);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);

  const ancho = filas[0]?.length ?? 0;
  filas.forEach((f, i) => {
    if (f.length !== ancho) {
      throw new ErrorDominio(`La fila ${i + 1} tiene ${f.length} columnas y el encabezado ${ancho}.`);
    }
  });
  return filas;
}

/** Neutraliza fórmulas (=, +, -, @) para que Excel no las ejecute al abrir el CSV. */
function celdaSegura(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function escribirCsv(encabezado: string[], filas: (string | number | null)[][]): string {
  return [encabezado, ...filas].map((f) => f.map(celdaSegura).join(',')).join('\r\n') + '\r\n';
}
