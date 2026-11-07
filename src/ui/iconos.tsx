const RUTAS: Record<string, string> = {
  panel: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  productos: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  existencias: 'M3 21V9l9-5 9 5v12M7 21v-7h10v7M7 17h10',
  pedidos: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  compras: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  clientes: 'M16 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7M21 20v-2a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8',
  proveedores: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6M9 11h.01M15 11h.01',
  reportes: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  auditoria: 'M12 8v4l3 2M3 12a9 9 0 109-9 9 9 0 00-6.7 3M3 4v4h4',
  consola: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  mas: 'M5 12h.01M12 12h.01M19 12h.01',
  buscar: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3',
  mas_: 'M12 5v14M5 12h14',
  cerrar: 'M6 6l12 12M18 6L6 18',
  editar: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  borrar: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  descargar: 'M12 4v11M7 11l5 5 5-5M4 20h16',
  subir: 'M12 16V5M7 9l5-5 5 5M4 20h16',
  ok: 'M5 12l5 5L20 7',
  alerta: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  salir: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
  traslado: 'M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4',
  deshacer: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  ayuda: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.5 9a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2M12 17h.01',
  flecha: 'M9 6l6 6-6 6',
  imprimir: 'M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  candado: 'M6 11h12v9H6zM8 11V7a4 4 0 018 0v4M12 15v2',
  perfil: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  ajustes: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  base: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
};

export type NombreIcono = keyof typeof RUTAS;

export function Icono({ n, tam = 20, className }: { n: NombreIcono; tam?: number; className?: string }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false" className={className}>
      <path d={RUTAS[n]} />
    </svg>
  );
}

/** Marca: bloque amarillo con una B de estantería. */
export function Marca({ tam = 34 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" fill="#ffc400" />
      <path d="M8 7h10a5 5 0 012.2 9.5A5 5 0 0118 26H8z" fill="#15140f" />
      <path d="M12.5 11v3.5H17a1.75 1.75 0 000-3.5zm0 7.5V22H18a1.75 1.75 0 000-3.5z" fill="#ffc400" />
    </svg>
  );
}
