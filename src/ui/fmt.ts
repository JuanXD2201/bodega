const dinero = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat('es-CO');
const compacto = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });

export const pesos = (n: number) => dinero.format(n).replace(/\s/g, ' ');
export const pesosCortos = (n: number) => (Math.abs(n) >= 1_000_000 ? `$ ${compacto.format(n)}` : pesos(n));
export const cant = (n: number) => numero.format(n);

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-11-06 14:30:00' -> '6 nov 2026' */
export function fechaCorta(t: string | null | undefined): string {
  if (!t) return '—';
  const [y, m, d] = t.slice(0, 10).split('-').map(Number);
  return `${d} ${MESES[(m ?? 1) - 1]} ${y}`;
}
export const hora = (t: string) => t.slice(11, 16);
export const diaMes = (t: string) => {
  const [, m, d] = t.slice(0, 10).split('-').map(Number);
  return `${d} ${MESES[(m ?? 1) - 1]}`;
};
export const fechaHora = (t: string) => `${fechaCorta(t)} · ${hora(t)}`;

export function descargar(nombre: string, contenido: BlobPart, tipo = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
