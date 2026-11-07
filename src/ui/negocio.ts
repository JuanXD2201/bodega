import { useCallback, useState } from 'react';

const CLAVE = 'bodega.negocio';
export const NEGOCIO_POR_DEFECTO = 'Bodega';

export function leerNegocio(): string {
  try {
    return localStorage.getItem(CLAVE)?.trim() || NEGOCIO_POR_DEFECTO;
  } catch {
    return NEGOCIO_POR_DEFECTO;
  }
}

export function guardarNegocio(nombre: string): void {
  try {
    const limpio = nombre.trim().slice(0, 80);
    if (limpio) localStorage.setItem(CLAVE, limpio);
    else localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: vale solo en esta sesión */
  }
}

export function borrarAjustesLocales(): void {
  try {
    localStorage.removeItem(CLAVE);
    sessionStorage.clear();
  } catch {
    /* nada que borrar */
  }
}

/** Nombre del negocio que se imprime en pedidos y órdenes de compra. */
export function useNegocio(): [string, (n: string) => void] {
  const [negocio, setNegocio] = useState(leerNegocio);
  const cambiar = useCallback((n: string) => {
    guardarNegocio(n);
    setNegocio(leerNegocio());
  }, []);
  return [negocio, cambiar];
}

export const VERSION_APP: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
