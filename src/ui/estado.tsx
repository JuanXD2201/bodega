import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { abrirDesdeBytes, cargarMotor, crearDbVacia, migrar, type Db } from '../data/db';
import { borrarBase, guardarBase, leerBase } from '../data/almacen';
import { ErrorDominio, tienePermiso, traducirError, type Contexto, type Permiso, type Usuario } from '../domain/nucleo';
import { sembrar, usuariosDemo } from '../seed/semilla';

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
  usuarios: Usuario[];
  version: number;
  guardado: EstadoGuardado;
  avisos: Aviso[];
  puede: (p: Permiso) => boolean;
  ejecutar: <T>(accion: () => T, opciones?: Opciones) => Resultado<T>;
  avisar: (a: Omit<Aviso, 'id'>) => void;
  cerrarAviso: (id: number) => void;
  salir: () => void;
  /** Reemplaza la base completa (importar o restablecer). */
  sustituirBase: (bytes: Uint8Array | null) => Promise<void>;
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

type Fase = { fase: 'cargando'; texto: string } | { fase: 'error'; texto: string } | { fase: 'listo'; db: Db };

export function Proveedor({ children, acceso }: { children: ReactNode; acceso: (entrar: (u: Usuario) => void, usuarios: Usuario[]) => ReactNode }) {
  const [estado, setEstado] = useState<Fase>({ fase: 'cargando', texto: 'Cargando el motor SQL…' });
  const [usuario, setUsuario] = useState<Usuario | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        await cargarMotor(localizar);
        setEstado({ fase: 'cargando', texto: 'Abriendo la base guardada…' });
        const guardada = await leerBase().catch(() => null);
        let db: Db;
        if (guardada) {
          try {
            db = await abrirDesdeBytes(guardada, localizar);
          } catch {
            db = await crearYSembrar();
          }
        } else {
          db = await crearYSembrar();
        }
        if (!vivo) return;
        const id = Number(sessionStorage.getItem(CLAVE_USUARIO));
        const previo = id ? usuariosDeBase(db).find((u) => u.id === id) : undefined;
        if (previo) setUsuario(previo);
        setEstado({ fase: 'listo', db });
      } catch (e) {
        if (vivo) setEstado({ fase: 'error', texto: e instanceof Error ? e.message : String(e) });
      }
    })();
    async function crearYSembrar() {
      setEstado({ fase: 'cargando', texto: 'Creando la base de demostración (64 productos, 150 pedidos)…' });
      await new Promise((r) => setTimeout(r, 30));
      const db = await crearDbVacia(localizar);
      sembrar(db, new Date());
      await guardarBase(db.exportar()).catch(() => undefined);
      return db;
    }
    return () => {
      vivo = false;
    };
  }, []);

  if (estado.fase === 'cargando') {
    return (
      <div className="arranque" role="status" aria-live="polite">
        <div className="arranque-barra" aria-hidden="true" />
        <p>{estado.texto}</p>
      </div>
    );
  }
  if (estado.fase === 'error') {
    return (
      <div className="arranque" role="alert">
        <h1>No se pudo abrir la base de datos</h1>
        <p>{estado.texto}</p>
        <button className="btn" onClick={() => { void borrarBase().finally(() => location.reload()); }}>Restablecer los datos guardados</button>
      </div>
    );
  }
  return (
    <Sesion db={estado.db} usuario={usuario} setUsuario={setUsuario}>
      {usuario ? children : null}
      {!usuario ? acceso((u) => { sessionStorage.setItem(CLAVE_USUARIO, String(u.id)); setUsuario(u); }, usuariosDeBase(estado.db)) : null}
    </Sesion>
  );
}

function usuariosDeBase(db: Db): Usuario[] {
  const filas = db.all<{ id: number; nombre: string; email: string; rol: Usuario['rol'] }>(
    'SELECT u.id, u.nombre, u.email, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.activo = 1 ORDER BY u.id',
  );
  return filas.length ? filas : usuariosDemo();
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
    async (bytes: Uint8Array | null) => {
      if (bytes) {
        db.reemplazar(bytes);
      } else {
        db.reemplazar(null);
        migrar(db);
        sembrar(db, new Date());
      }
      await guardarBase(db.exportar());
      setVersion((v) => v + 1);
    },
    [db],
  );

  const salir = useCallback(() => {
    sessionStorage.removeItem(CLAVE_USUARIO);
    setUsuario(null);
    location.hash = '#/';
  }, [setUsuario]);

  const valor = useMemo<Aplicacion | null>(
    () =>
      ctx && usuario
        ? {
            db, ctx, usuario, usuarios: usuariosDeBase(db), version, guardado, avisos,
            puede: (p) => tienePermiso(usuario.rol, p),
            ejecutar, avisar, cerrarAviso, salir, sustituirBase,
          }
        : null,
    [db, ctx, usuario, version, guardado, avisos, ejecutar, avisar, cerrarAviso, salir, sustituirBase],
  );

  if (!valor) return <>{children}</>;
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
