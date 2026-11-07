/** Espera creciente tras PINs incorrectos: frena el tanteo desde la interfaz (no es protección contra quien lea los datos del navegador). */
export function esperaTrasFallos(fallos: number): number {
  if (fallos < 3) return 0;
  if (fallos < 5) return 5_000;
  if (fallos < 8) return 30_000;
  return 300_000;
}
