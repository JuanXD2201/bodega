/**
 * PIN de los perfiles de acceso locales: nunca se guarda el PIN, solo un hash
 * PBKDF2-SHA-256 con sal aleatoria por perfil, y se compara en tiempo constante.
 * Es control de acceso local del navegador: no sustituye a un servidor de autenticación.
 */

export const ITERACIONES_PIN = 120_000;
const BYTES_SAL = 16;
const BITS_HASH = 256;

export interface Credencial {
  /** Hash en hexadecimal. */
  hash: string;
  /** Sal en hexadecimal. */
  sal: string;
  iteraciones: number;
}

export const aHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function deHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('Hexadecimal inválido.');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Devuelve el motivo si el PIN no es válido: de 4 a 8 dígitos. */
export function validarPin(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return 'El PIN debe tener entre 4 y 8 dígitos.';
  return null;
}

export async function derivarHash(pin: string, sal: Uint8Array, iteraciones: number): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: iteraciones }, clave, BITS_HASH);
  return new Uint8Array(bits);
}

/** Compara dos secuencias de bytes recorriéndolas siempre completas, sin salir en el primer byte distinto. */
export function igualesEnTiempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  let diferencia = a.length ^ b.length;
  const largo = Math.max(a.length, b.length);
  for (let i = 0; i < largo; i++) diferencia |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diferencia === 0;
}

export async function crearCredencial(pin: string, iteraciones: number = ITERACIONES_PIN): Promise<Credencial> {
  const motivo = validarPin(pin);
  if (motivo) throw new Error(motivo);
  const sal = crypto.getRandomValues(new Uint8Array(BYTES_SAL));
  return { hash: aHex(await derivarHash(pin, sal, iteraciones)), sal: aHex(sal), iteraciones };
}

export async function verificarPin(pin: string, cred: Credencial): Promise<boolean> {
  let esperado: Uint8Array;
  let sal: Uint8Array;
  try {
    esperado = deHex(cred.hash);
    sal = deHex(cred.sal);
  } catch {
    return false;
  }
  const calculado = await derivarHash(pin, sal, cred.iteraciones);
  return igualesEnTiempoConstante(calculado, esperado);
}
