import { Component, useEffect, useState, type ReactNode } from 'react';
import { Proveedor, useApp } from './estado';
import { Boton, CodigoBarras, Enlace, Modal, useRuta, ir } from './componentes';
import { Icono, Marca, type NombreIcono } from './iconos';
import { ETIQUETA_ROL, type Permiso, type Usuario } from '../domain/nucleo';
import { Panel } from './paginas/Panel';
import { Productos } from './paginas/Productos';
import { Existencias } from './paginas/Existencias';
import { Pedidos } from './paginas/Pedidos';
import { Compras } from './paginas/Compras';
import { Clientes, Proveedores } from './paginas/Terceros';
import { Reportes } from './paginas/Reportes';
import { Auditoria } from './paginas/Auditoria';
import { Consola } from './paginas/Consola';

interface ItemNav { id: string; texto: string; icono: NombreIcono; permiso: Permiso; atajo: string }

const NAV: { grupo: string; items: ItemNav[] }[] = [
  {
    grupo: 'Operación',
    items: [
      { id: 'panel', texto: 'Panel', icono: 'panel', permiso: 'reportes.ver', atajo: 'd' },
      { id: 'pedidos', texto: 'Pedidos', icono: 'pedidos', permiso: 'pedidos.ver', atajo: 'v' },
      { id: 'compras', texto: 'Compras', icono: 'compras', permiso: 'compras.ver', atajo: 'c' },
      { id: 'existencias', texto: 'Existencias', icono: 'existencias', permiso: 'existencias.ver', atajo: 'e' },
      { id: 'productos', texto: 'Productos', icono: 'productos', permiso: 'productos.ver', atajo: 'p' },
    ],
  },
  {
    grupo: 'Terceros',
    items: [
      { id: 'clientes', texto: 'Clientes', icono: 'clientes', permiso: 'clientes.ver', atajo: 'l' },
      { id: 'proveedores', texto: 'Proveedores', icono: 'proveedores', permiso: 'proveedores.ver', atajo: 'o' },
    ],
  },
  {
    grupo: 'Análisis',
    items: [
      { id: 'reportes', texto: 'Reportes', icono: 'reportes', permiso: 'reportes.ver', atajo: 'r' },
      { id: 'auditoria', texto: 'Auditoría', icono: 'auditoria', permiso: 'auditoria.ver', atajo: 'a' },
      { id: 'consola', texto: 'Consola SQL', icono: 'consola', permiso: 'sql.consultar', atajo: 's' },
    ],
  },
];
const PRINCIPALES_MOVIL = ['panel', 'productos', 'existencias', 'pedidos'];

export function App() {
  return (
    <ErrorLimite>
      <Proveedor acceso={(entrar, usuarios) => <Acceso entrar={entrar} usuarios={usuarios} />}>
        <Carcasa />
      </Proveedor>
    </ErrorLimite>
  );
}

class ErrorLimite extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="arranque" role="alert">
          <h1>Algo salió mal</h1>
          <p>{this.state.error.message}</p>
          <button className="btn" onClick={() => location.reload()}>Recargar</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// -------------------------------------------------------------------- acceso

const DESCRIPCION_ROL = {
  administrador: 'Catálogo, compras, terceros, auditoría y administración de la base.',
  vendedor: 'Crea y confirma sus pedidos y gestiona clientes.',
  bodeguero: 'Despacha, ajusta, traslada existencias y recibe compras.',
} as const;

function Acceso({ entrar, usuarios }: { entrar: (u: Usuario) => void; usuarios: Usuario[] }) {
  return (
    <main className="acceso">
      <div className="acceso-franja" aria-hidden="true" />
      <section className="acceso-panel">
        <div className="acceso-marca">
          <Marca tam={44} />
          <div>
            <h1>Bodega</h1>
            <p>Inventario, compras y pedidos</p>
          </div>
        </div>
        <p className="acceso-demo" role="note">
          <strong>Demostración.</strong> No hay contraseñas ni servidor: elige un usuario de prueba para recorrer el sistema con los permisos de su rol. Los datos viven en una base SQLite dentro de tu navegador.
        </p>
        <h2>¿Con qué usuario quieres entrar?</h2>
        <ul className="acceso-lista">
          {usuarios.map((u) => (
            <li key={u.id}>
              <button type="button" className="acceso-usuario" onClick={() => entrar(u)} data-usuario={u.rol}>
                <span className="acceso-avatar" aria-hidden="true">{u.nombre.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                <span>
                  <b>{u.nombre}</b>
                  <small>{ETIQUETA_ROL[u.rol]} · {DESCRIPCION_ROL[u.rol]}</small>
                </span>
                <Icono n="flecha" tam={18} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <aside className="acceso-lateral" aria-hidden="true">
        <CodigoBarras semilla="bodega-demo" alto={90} ancho={300} decorativo />
        <p>Proyecto de portafolio · SQLite en WebAssembly</p>
      </aside>
    </main>
  );
}

// ------------------------------------------------------------------ carcasa

function Carcasa() {
  const { usuario, puede, guardado, avisos, cerrarAviso, salir } = useApp();
  const { ruta, partes } = useRuta();
  const [ayuda, setAyuda] = useState(false);
  const [mas, setMas] = useState(false);

  const visibles = NAV.map((g) => ({ ...g, items: g.items.filter((i) => puede(i.permiso)) })).filter((g) => g.items.length);
  const todos = visibles.flatMap((g) => g.items);
  const inicio = todos[0]?.id ?? 'productos';

  useEffect(() => {
    if (!ruta) ir(inicio);
  }, [ruta, inicio]);

  useEffect(() => {
    const titulo = todos.find((i) => i.id === ruta)?.texto;
    document.title = `${titulo ? titulo + ' · ' : ''}Bodega`;
  }, [ruta, todos]);

  // Atajos de teclado: «g» + letra navega, «/» busca, «n» crea, «?» ayuda.
  useEffect(() => {
    let esperandoG = 0;
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.matches('input, textarea, select, [contenteditable]') || document.body.classList.contains('modal-abierto')) return;
      if (esperandoG && Date.now() - esperandoG < 1200) {
        esperandoG = 0;
        const destino = todos.find((i) => i.atajo === e.key.toLowerCase());
        if (destino) { e.preventDefault(); ir(destino.id); }
        return;
      }
      if (e.key === 'g') esperandoG = Date.now();
      else if (e.key === '/') {
        const campo = document.querySelector<HTMLInputElement>('[data-busqueda]');
        if (campo) { e.preventDefault(); campo.focus(); campo.select(); }
      } else if (e.key === 'n') {
        document.querySelector<HTMLElement>('[data-atajo-nuevo]')?.click();
      } else if (e.key === '?') setAyuda(true);
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [todos]);

  useEffect(() => setMas(false), [ruta]);

  const permitido = todos.some((i) => i.id === ruta);
  const pagina = !ruta ? null : !permitido ? <SinAcceso /> : paginaDe(ruta, partes);

  return (
    <div className="carcasa">
      <a className="salto" href="#contenido" onClick={(e) => { e.preventDefault(); document.getElementById('contenido')?.focus(); }}>Saltar al contenido</a>
      <aside className="lateral">
        <Enlace a={inicio} className="lateral-marca" aria-label="Bodega, ir al inicio">
          <Marca />
          <span>Bodega</span>
        </Enlace>
        <nav aria-label="Principal">
          {visibles.map((g) => (
            <div key={g.grupo} className="nav-grupo">
              <p className="nav-titulo">{g.grupo}</p>
              {g.items.map((i) => (
                <Enlace key={i.id} a={i.id} className={`nav-item ${ruta === i.id ? 'activo' : ''}`} aria-current={ruta === i.id ? 'page' : undefined}>
                  <Icono n={i.icono} />
                  {i.texto}
                </Enlace>
              ))}
            </div>
          ))}
        </nav>
        <div className="lateral-pie">
          <button type="button" className="lateral-ayuda" onClick={() => setAyuda(true)}><Icono n="ayuda" tam={16} /> Atajos de teclado</button>
        </div>
      </aside>

      <div className="cuerpo">
        <header className="barra">
          <div className="barra-franja" aria-hidden="true" />
          <div className="barra-contenido">
            <span className="barra-ruta">{todos.find((i) => i.id === ruta)?.texto ?? 'Bodega'}</span>
            <div className="barra-der">
              <span className={`guardado guardado-${guardado}`} role="status" aria-live="polite" data-estado-guardado={guardado}>
                <i aria-hidden="true" />
                {guardado === 'guardado' ? 'Guardado en el navegador' : guardado === 'guardando' ? 'Guardando…' : 'No se pudo guardar'}
              </span>
              <div className="usuario">
                <span className="usuario-nombre" data-usuario-activo>
                  <b>{usuario.nombre}</b>
                  <small>{ETIQUETA_ROL[usuario.rol]}</small>
                </span>
                <Boton icono="salir" variante="fantasma" onClick={salir} aria-label="Cambiar de usuario"><span className="solo-escritorio">Cambiar usuario</span></Boton>
              </div>
            </div>
          </div>
        </header>
        <main id="contenido" tabIndex={-1} className="contenido">
          {pagina}
        </main>
      </div>

      <nav className="nav-movil" aria-label="Navegación móvil">
        {todos.filter((i) => PRINCIPALES_MOVIL.includes(i.id)).map((i) => (
          <Enlace key={i.id} a={i.id} className={ruta === i.id ? 'activo' : ''} aria-current={ruta === i.id ? 'page' : undefined}>
            <Icono n={i.icono} tam={22} />
            <span>{i.texto}</span>
          </Enlace>
        ))}
        <button type="button" className={mas ? 'activo' : ''} onClick={() => setMas(true)} aria-haspopup="dialog">
          <Icono n="mas" tam={22} />
          <span>Más</span>
        </button>
      </nav>

      {mas ? (
        <Modal titulo="Más secciones" onCerrar={() => setMas(false)}>
          <div className="mas-lista">
            {todos.filter((i) => !PRINCIPALES_MOVIL.includes(i.id)).map((i) => (
              <Enlace key={i.id} a={i.id} className="mas-item" onClick={() => setMas(false)}>
                <Icono n={i.icono} /> {i.texto}
              </Enlace>
            ))}
            <button type="button" className="mas-item" onClick={() => { setMas(false); salir(); }}><Icono n="salir" /> Cambiar de usuario ({usuario.nombre})</button>
          </div>
        </Modal>
      ) : null}

      <div className="avisos" role="region" aria-label="Notificaciones">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso aviso-${a.tipo}`} role={a.tipo === 'error' ? 'alert' : 'status'}>
            <Icono n={a.tipo === 'error' ? 'alerta' : 'ok'} tam={18} />
            <div className="aviso-texto">
              <p>{a.texto}</p>
              {a.detalles?.length ? <ul>{a.detalles.slice(0, 6).map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
            </div>
            {a.deshacer ? <button type="button" className="aviso-deshacer" onClick={() => { a.deshacer?.(); cerrarAviso(a.id); }}><Icono n="deshacer" tam={16} /> Deshacer</button> : null}
            <button type="button" className="aviso-cerrar" aria-label="Cerrar aviso" onClick={() => cerrarAviso(a.id)}><Icono n="cerrar" tam={16} /></button>
          </div>
        ))}
      </div>

      {ayuda ? <AyudaAtajos onCerrar={() => setAyuda(false)} items={todos} /> : null}
    </div>
  );
}

function paginaDe(ruta: string, partes: string[]): ReactNode {
  switch (ruta) {
    case 'panel': return <Panel />;
    case 'productos': return <Productos />;
    case 'existencias': return <Existencias />;
    case 'pedidos': return <Pedidos partes={partes} />;
    case 'compras': return <Compras partes={partes} />;
    case 'clientes': return <Clientes />;
    case 'proveedores': return <Proveedores />;
    case 'reportes': return <Reportes />;
    case 'auditoria': return <Auditoria />;
    case 'consola': return <Consola />;
    default: return <SinAcceso />;
  }
}

function SinAcceso() {
  const { usuario } = useApp();
  return (
    <div className="vacio vacio-pagina" role="alert">
      <h1>Sin acceso a esta sección</h1>
      <p>El rol {ETIQUETA_ROL[usuario.rol]} no tiene permiso para verla. El permiso se valida en la lógica de negocio, no solo en el menú.</p>
      <Enlace a="" className="btn btn-primario">Volver al inicio</Enlace>
    </div>
  );
}

function AyudaAtajos({ onCerrar, items }: { onCerrar: () => void; items: ItemNav[] }) {
  return (
    <Modal titulo="Atajos de teclado" onCerrar={onCerrar}>
      <dl className="atajos">
        <div><dt><kbd>g</kbd> luego una letra</dt><dd>Ir a una sección</dd></div>
        {items.map((i) => (
          <div key={i.id} className="atajo-sub"><dt><kbd>g</kbd> <kbd>{i.atajo}</kbd></dt><dd>{i.texto}</dd></div>
        ))}
        <div><dt><kbd>/</kbd></dt><dd>Buscar en la lista actual</dd></div>
        <div><dt><kbd>n</kbd></dt><dd>Crear un registro nuevo</dd></div>
        <div><dt><kbd>Ctrl</kbd> + <kbd>Enter</kbd></dt><dd>Ejecutar la consulta en la consola SQL</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>Cerrar un cuadro de diálogo</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>Mostrar esta ayuda</dd></div>
      </dl>
    </Modal>
  );
}
