import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { abrirDesdeBytes, cargarMotor, crearDbVacia, migrar, type Db } from '../data/db';
import { borrarBase, guardarBase, leerBase } from '../data/almacen';
import { ErrorDominio, tienePermiso, traducirError, type Contexto, type Permiso, type Usuario } from '../domain/nucleo';
import { inicializarBaseVacia, perfilesActivos, type Perfil } from '../domain/perfiles';
import { crearCredencial, validarPin } from '../domain/pin';
import { sembrar } from '../seed/semilla';
import { borrarAjustesLocales, guardarNegocio } from './negocio';

// El motor siempre se sirve desde public/sql-wasm.wasm, sin importar el nombre que pida sql.js.
const localizar = (_f: string) => new URL('sql-wasm.wasm', document.baseURI).href;
const CLAVE_USUARIO = 'bodega.usuario';

export type EstadoGuardado = 'guardado' | 'guardando' | 'error';

export interface Aviso {
  id: number;
  tipo: 'ok' | 'error' | 'info';
  texto: string;
  detalles?: string[];
  deshacer?: () => void;
}

export interface Resultado<T> {
  ok: boolean;
  valor?: T;
  error?: ErrorDominio;
}

interface Opciones {
  /** Texto del aviso de éxito. Sin texto no se muestra aviso. */
  ok?: string | ((valor: never) => string);
  /** Permite deshacer la operación mientras el aviso esté visible. */
  deshacer?: boolean;
  /** No mostrar aviso de error (el formulario muestra el mensaje). */
  enLinea?: boolean;
}

interface Aplicacion {
  db: Db;
  ctx: Contexto;
  usuario: Usuario;
  usuarios: Perfil[];
  version: number;
  guardado: EstadoGuardado;
  avisos: Aviso[];
  puede: (p: Permiso) => boolean;
  ejecutar: <T>(accion: () => T, opciones?: Opciones) => Resultado<T>;
  avisar: (a: Omit<Aviso, 'id'>) => void;
  cerrarAviso: (id: number) => void;
  salir: () => void;
  /** Reemplaza la base completa con un archivo importado y vuelve a pedir el perfil. */
  sustituirBase: (bytes: Uint8Array) => Promise<void>;
  /** Borra la base y los ajustes del navegador y vuelve a la bienvenida. */
  borrarTodo: () => Promise<void>;
}

const Ctx = createContext<Aplicacion | null>(null);

export function useApp(): Aplicacion {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fuera de <Proveedor>');
  return v;
}

/** Valor derivado de la base que se recalcula cuando cambian los datos. */
export function useConsulta<T>(fn: (ctx: Contexto) => T, deps: unknown[] = []): T {
  const { ctx, version } = useApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn(ctx), [ctx, version, ...deps]);
}

export interface AccionesBienvenida {
  /** Base vacía con un primer perfil de administrador (PIN opcional) y entra con él. */
  vacia: (nombre: string, pin: string | null, negocio: string) => Promise<void>;
  /** Base con datos de ejemplo para explorar. */
  ejemplo: () => Promise<void>;
}

export interface PropiedadesAcceso {
  db: Db;
  perfiles: Perfil[];
  entrar: (u: Usuario) => void;
}

type Fase =
  | { fase: 'cargando'; texto: string }
  | { fase: 'error'; texto: string; bytes: Uint8Array | null }
  | { fase: 'bienvenida' }
  | { fase: 'listo'; db: Db };

export function Proveedor({ children, bienvenida, acceso }: { children: ReactNode; bienvenida: (a: AccionesBienvenida) => ReactNode; acceso: (p: PropiedadesAcceso) => ReactNode }) {
  const [estado, setEstado] = useState<Fase>({ fase: 'cargando', texto: 'Cargando el motor SQL…' });
  const [usuario, setUsuario] = useState<Usuario | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        await cargarMotor(localizar);
        setEstado({ fase: 'cargando', texto: 'Abriendo la base guardada…' });
        const guardada = await leerBase().catch(() => null);
        if (!guardada) {
          if (vivo) setEstado({ fase: 'bienvenida' });
          return;
        }
        let db: Db;
        try {
          db = await abrirDesdeBytes(guardada, localizar);
        } catch (e) {
          if (vivo) setEstado({ fase: 'error', texto: e instanceof Error ? e.message : String(e), bytes: guardada });
          return;
        }
        if (!vivo) return;
        const id = Number(sessionStorage.getItem(CLAVE_USUARIO));
        const previo = id ? perfilesActivos(db).find((u) => u.id === id) : undefined;
        if (previo) setUsuario(previo);
        setEstado({ fase: 'listo', db });
      } catch (e) {
        if (vivo) setEstado({ fase: 'error', texto: e instanceof Error ? e.message : String(e), bytes: null });
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const acciones = useMemo<AccionesBienvenida>(
    () => ({
      async vacia(nombre, pin, negocio) {
        if (pin) {
          const motivo = validarPin(pin);
          if (motivo) throw new ErrorDominio(motivo);
        }
        const credencial = pin ? await crearCredencial(pin) : null;
        const db = await crearDbVacia(localizar);
        const admin = inicializarBaseVacia(db, { nombre, credencial });
        guardarNegocio(negocio);
        await guardarBase(db.exportar());
        sessionStorage.setItem(CLAVE_USUARIO, String(admin.id));
        setUsuario(admin);
        setEstado({ fase: 'listo', db });
      },
      async ejemplo() {
        setEstado({ fase: 'cargando', texto: 'Preparando los datos de ejemplo (64 productos, 150 pedidos)…' });
        await new Promise((r) => setTimeout(r, 30));
        const db = await crearDbVacia(localizar);
        sembrar(db, new Date());
        await guardarBase(db.exportar()).catch(() => undefined);
        setEstado({ fase: 'listo', db });
      },
    }),
    [],
  );

  if (estado.fase === 'cargando') {
    return (
      <div className="arranque" role="status" aria-live="polite">
        <div className="arranque-barra" aria-hidden="true" />
        <p>{estado.texto}</p>
      </div>
    );
  }
  if (estado.fase === 'error') {
    return <ErrorBase texto={estado.texto} bytes={estado.bytes} />;
  }
  if (estado.fase === 'bienvenida') return <>{bienvenida(acciones)}</>;
  return (
    <Sesion db={estado.db} usuario={usuario} setUsuario={setUsuario}>
      {usuario ? children : null}
      {!usuario ? acceso({ db: estado.db, perfiles: perfilesActivos(estado.db), entrar: (u) => { sessionStorage.setItem(CLAVE_USUARIO, String(u.id)); setUsuario(u); } }) : null}
    </Sesion>
  );
}

function ErrorBase({ texto, bytes }: { texto: string; bytes: Uint8Array | null }) {
  const [confirmando, setConfirmando] = useState(false);
  const bajarCopia = () => {
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/vnd.sqlite3' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bodega-copia-original.sqlite';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="arranque" role="alert">
      <h1>No se pudo abrir la base de datos</h1>
      <p>{texto}</p>
      <p>Tus datos guardados no se han modificado. Puedes descargar una copia tal como está antes de empezar de nuevo.</p>
      <div className="descargas-acciones">
        {bytes ? <button className="btn" onClick={bajarCopia}>Descargar copia original</button> : null}
        {confirmando ? (
          <button className="btn btn-peligro" onClick={() => { void borrarBase().finally(() => location.reload()); }}>Sí, borrar y empezar de nuevo</button>
        ) : (
          <button className="btn btn-secundario" onClick={() => setConfirmando(true)}>Empezar de nuevo</button>
        )}
      </div>
    </div>
  );
}

function Sesion({ db, usuario, setUsuario, children }: { db: Db; usuario: Usuario | null; setUsuario: (u: Usuario | null) => void; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [guardado, setGuardado] = useState<EstadoGuardado>('guardado');
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const contador = useRef(0);
  const cola = useRef<Promise<void>>(Promise.resolve());
  const pendientes = useRef(0);

  const persistir = useCallback(() => {
    pendientes.current++;
    setGuardado('guardando');
    cola.current = cola.current
      .then(() => guardarBase(db.exportar()))
      .then(() => {
        pendientes.current--;
        if (pendientes.current === 0) setGuardado('guardado');
      })
      .catch(() => {
        pendientes.current--;
        setGuardado('error');
      });
  }, [db]);

  const avisar = useCallback((a: Omit<Aviso, 'id'>) => {
    const id = ++contador.current;
    setAvisos((x) => [...x.slice(-3), { ...a, id }]);
    if (!a.deshacer && a.tipo !== 'error') setTimeout(() => setAvisos((x) => x.filter((y) => y.id !== id)), 5000);
    if (a.deshacer) setTimeout(() => setAvisos((x) => x.filter((y) => y.id !== id)), 12000);
  }, []);
  const cerrarAviso = useCallback((id: number) => setAvisos((x) => x.filter((y) => y.id !== id)), []);

  const ctx = useMemo<Contexto | null>(() => (usuario ? { db, usuario, ahora: () => new Date() } : null), [db, usuario]);

  const ejecutar = useCallback(
    <T,>(accion: () => T, o: Opciones = {}): Resultado<T> => {
      const antes = o.deshacer ? db.exportar() : null;
      try {
        const valor = accion();
        setVersion((v) => v + 1);
        persistir();
        if (o.ok || antes) {
          avisar({
            tipo: 'ok',
            texto: typeof o.ok === 'function' ? (o.ok as (v: T) => string)(valor) : (o.ok ?? 'Hecho'),
            deshacer: antes
              ? () => {
                  db.reemplazar(antes);
                  setVersion((v) => v + 1);
                  persistir();
                  avisar({ tipo: 'info', texto: 'Operación deshecha.' });
                }
              : undefined,
          });
        }
        return { ok: true, valor };
      } catch (e) {
        const error = traducirError(e);
        setVersion((v) => v + 1);
        if (!o.enLinea) avisar({ tipo: 'error', texto: error.message, detalles: error.detalles });
        return { ok: false, error };
      }
    },
    [db, persistir, avisar],
  );

  const sustituirBase = useCallback(
    async (bytes: Uint8Array) => {
      db.reemplazar(bytes);
      migrar(db);
      await guardarBase(db.exportar());
      // El perfil en uso puede no existir en la base importada: se vuelve a pedir quién entra.
      sessionStorage.removeItem(CLAVE_USUARIO);
      location.reload();
    },
    [db],
  );

  const borrarTodo = useCallback(async () => {
    await borrarBase();
    borrarAjustesLocales();
    location.hash = '#/';
    location.reload();
  }, []);

  const salir = useCallback(() => {
    sessionStorage.removeItem(CLAVE_USUARIO);
    setUsuario(null);
    location.hash = '#/';
  }, [setUsuario]);

  const valor = useMemo<Aplicacion | null>(
    () =>
      ctx && usuario
        ? {
            db, ctx, usuario, usuarios: perfilesActivos(db), version, guardado, avisos,
            puede: (p) => tienePermiso(usuario.rol, p),
            ejecutar, avisar, cerrarAviso, salir, sustituirBase, borrarTodo,
          }
        : null,
    [db, ctx, usuario, version, guardado, avisos, ejecutar, avisar, cerrarAviso, salir, sustituirBase, borrarTodo],
  );

  if (!valor) return <>{children}</>;
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
