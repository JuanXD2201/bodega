import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icono, type NombreIcono } from './iconos';
import { ErrorDominio } from '../domain/nucleo';

// ---------------------------------------------------------------- enrutador

function suscribir(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
const leerHash = () => location.hash || '#/';

export function useRuta(): { partes: string[]; ruta: string } {
  const h = useSyncExternalStore(suscribir, leerHash, () => '#/');
  const limpio = h.replace(/^#\/?/, '').split('?')[0] ?? '';
  const partes = limpio.split('/').filter(Boolean);
  return { partes, ruta: partes[0] ?? '' };
}

/** Texto de búsqueda que trae el enlace (p. ej. desde la búsqueda global): #/productos?q=HER-1001. */
export const consultaInicial = (): string => new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? '';

export const ir = (destino: string) => {
  location.hash = `#/${destino}`;
};

export function Enlace({ a, children, className, ...resto }: { a: string; children: ReactNode; className?: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={`#/${a}`} className={className} {...resto}>
      {children}
    </a>
  );
}

// ------------------------------------------------------------------ botones

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';

export function Boton({
  variante = 'secundario', icono, children, className = '', ...resto
}: { variante?: Variante; icono?: NombreIcono } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn btn-${variante} ${className}`} {...resto}>
      {icono ? <Icono n={icono} tam={18} /> : null}
      {children}
    </button>
  );
}

export function BotonIcono({ icono, etiqueta, ...resto }: { icono: NombreIcono; etiqueta: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="btn-icono" aria-label={etiqueta} title={etiqueta} {...resto}>
      <Icono n={icono} tam={18} />
    </button>
  );
}

// ------------------------------------------------------------------- modal

export function Modal({ titulo, onCerrar, children, pie, ancho = 'normal' }: {
  titulo: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode; ancho?: 'normal' | 'ancho';
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const raiz = ref.current!;
    const foco = raiz.querySelector<HTMLElement>('[data-foco], input:not([type=hidden]), select, textarea') ?? raiz.querySelector<HTMLElement>('button');
    foco?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCerrar();
      }
      if (e.key === 'Tab') {
        const items = [...raiz.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
        if (!items.length) return;
        const primero = items[0]!;
        const ultimo = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    };
    document.addEventListener('keydown', tecla, true);
    document.body.classList.add('modal-abierto');
    return () => {
      document.removeEventListener('keydown', tecla, true);
      document.body.classList.remove('modal-abierto');
      previo?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div ref={ref} className={`modal modal-${ancho}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="modal-cab">
          <h2 id={id}>{titulo}</h2>
          <BotonIcono icono="cerrar" etiqueta="Cerrar" onClick={onCerrar} />
        </header>
        <div className="modal-cuerpo">{children}</div>
        {pie ? <footer className="modal-pie">{pie}</footer> : null}
      </div>
    </div>
  );
}

export function Confirmar({ titulo, texto, textoBoton, peligro, onConfirmar, onCerrar }: {
  titulo: string; texto: ReactNode; textoBoton: string; peligro?: boolean; onConfirmar: () => void; onCerrar: () => void;
}) {
  return (
    <Modal
      titulo={titulo}
      onCerrar={onCerrar}
      pie={
        <>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante={peligro ? 'peligro' : 'primario'} data-foco onClick={() => { onConfirmar(); onCerrar(); }}>{textoBoton}</Boton>
        </>
      }
    >
      <p>{texto}</p>
    </Modal>
  );
}

// ----------------------------------------------------------------- formularios

export function Campo({ etiqueta, error, ayuda, children, className = '' }: {
  etiqueta: string; error?: string; ayuda?: string; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode; className?: string;
}) {
  const id = useId();
  const desc = error ? `${id}-e` : ayuda ? `${id}-a` : undefined;
  return (
    <div className={`campo ${error ? 'campo-error' : ''} ${className}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children({ id, 'aria-describedby': desc, 'aria-invalid': error ? true : undefined })}
      {error ? <p className="campo-msg" id={`${id}-e`}>{error}</p> : ayuda ? <p className="campo-ayuda" id={`${id}-a`}>{ayuda}</p> : null}
    </div>
  );
}

export function ErrorFormulario({ error }: { error: ErrorDominio | string | null | undefined }) {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  const det = typeof error === 'string' ? [] : error.detalles;
  return (
    <div className="aviso-form" role="alert">
      <Icono n="alerta" tam={18} />
      <div>
        <p>{msg}</p>
        {det.length ? <ul>{det.slice(0, 8).map((d, i) => <li key={i}>{d}</li>)}{det.length > 8 ? <li>y {det.length - 8} más…</li> : null}</ul> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ piezas

const ESTADOS: Record<string, { clase: string; texto: string }> = {
  borrador: { clase: 'neutro', texto: 'Borrador' },
  confirmado: { clase: 'aviso', texto: 'Confirmado' },
  despachado: { clase: 'ok', texto: 'Despachado' },
  anulado: { clase: 'error', texto: 'Anulado' },
  enviada: { clase: 'aviso', texto: 'Enviada' },
  parcial: { clase: 'info', texto: 'Parcial' },
  recibida: { clase: 'ok', texto: 'Recibida' },
  anulada: { clase: 'error', texto: 'Anulada' },
  activo: { clase: 'ok', texto: 'Activo' },
  inactivo: { clase: 'neutro', texto: 'Inactivo' },
};

export function Insignia({ estado }: { estado: string }) {
  const e = ESTADOS[estado] ?? { clase: 'neutro', texto: estado };
  return <span className={`insignia insignia-${e.clase}`}>{e.texto}</span>;
}

export function Vacio({ titulo, texto, accion }: { titulo: string; texto?: string; accion?: ReactNode }) {
  return (
    <div className="vacio">
      <CodigoBarras semilla={titulo} alto={34} decorativo />
      <h3>{titulo}</h3>
      {texto ? <p>{texto}</p> : null}
      {accion}
    </div>
  );
}

export function Cabecera({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children?: ReactNode }) {
  return (
    <header className="cabecera-pagina">
      <div>
        <h1>{titulo}</h1>
        {subtitulo ? <p>{subtitulo}</p> : null}
      </div>
      {children ? <div className="cabecera-acciones">{children}</div> : null}
    </header>
  );
}

/** Código de barras decorativo y determinista a partir de un texto. */
export function CodigoBarras({ semilla, alto = 28, ancho = 120, decorativo = false }: { semilla: string; alto?: number; ancho?: number; decorativo?: boolean }) {
  let h = 2166136261;
  for (const c of semilla) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const barras: { x: number; w: number }[] = [];
  let x = 0;
  let i = 0;
  while (x < ancho - 3) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const w = 1 + ((h >>> (i % 7)) & 3);
    if (i % 2 === 0) barras.push({ x, w });
    x += w + 1;
    i++;
  }
  return (
    <svg className="codigo-barras" width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role={decorativo ? undefined : 'img'} aria-hidden={decorativo ? true : undefined} aria-label={decorativo ? undefined : `Código de barras de ${semilla}`} preserveAspectRatio="none">
      {barras.map((b, k) => <rect key={k} x={b.x} y={0} width={b.w} height={alto} fill="currentColor" />)}
    </svg>
  );
}

/** Rótulo de estantería: SKU en mono, nombre y barras. */
export function Rotulo({ sku, nombre, detalle }: { sku: string; nombre: string; detalle?: string }) {
  return (
    <div className="rotulo">
      <div className="rotulo-sku">{sku}</div>
      <div className="rotulo-nombre">{nombre}</div>
      {detalle ? <div className="rotulo-detalle">{detalle}</div> : null}
      <CodigoBarras semilla={sku} alto={30} ancho={150} />
      <div className="rotulo-num">{sku.replace(/\D/g, '').padStart(8, '0')}</div>
    </div>
  );
}

export function Sku({ children }: { children: string }) {
  return <span className="sku">{children}</span>;
}

/** Indicador de stock: valor mono + barra frente al mínimo. */
export function NivelStock({ stock, minimo }: { stock: number; minimo: number }) {
  const estado = stock === 0 ? 'agotado' : stock < minimo ? 'bajo' : 'ok';
  const pct = minimo > 0 ? Math.min(100, Math.round((stock / (minimo * 2)) * 100)) : 100;
  return (
    <span className={`nivel nivel-${estado}`}>
      <span className="cant">{stock.toLocaleString('es-CO')}</span>
      <span className="nivel-barra" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      <span className="sr-only">{estado === 'ok' ? 'stock suficiente' : estado === 'bajo' ? 'stock bajo el mínimo' : 'agotado'}</span>
    </span>
  );
}

export function Pestanas<T extends string>({ valor, onCambio, opciones, etiqueta }: { valor: T; onCambio: (v: T) => void; opciones: { id: T; texto: string }[]; etiqueta: string }) {
  return (
    <div className="pestanas" role="tablist" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.id} role="tab" type="button" aria-selected={valor === o.id} className={valor === o.id ? 'activa' : ''} onClick={() => onCambio(o.id)}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function useDebounce<T>(valor: T, ms = 200): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function Buscador({ valor, onCambio, placeholder }: { valor: string; onCambio: (v: string) => void; placeholder: string }) {
  return (
    <div className="buscador">
      <Icono n="buscar" tam={18} />
      <input type="search" data-busqueda value={valor} onChange={(e) => onCambio(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <kbd aria-hidden="true">/</kbd>
    </div>
  );
}
