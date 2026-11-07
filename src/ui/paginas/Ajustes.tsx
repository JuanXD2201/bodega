import { useState, type FormEvent } from 'react';
import { abrirDesdeBytes } from '../../data/db';
import { eliminarCategoria, guardarBodega, guardarCategoria, listarBodegasOrg, listarCategoriasOrg, type BodegaOrg, type CategoriaOrg } from '../../domain/organizacion';
import type { ErrorDominio } from '../../domain/nucleo';
import { checkForUpdate } from '../../pwa';
import { useApp, useConsulta } from '../estado';
import { Boton, BotonIcono, Cabecera, Campo, Confirmar, ErrorFormulario, Insignia, Modal } from '../componentes';
import { descargar } from '../fmt';
import { Icono } from '../iconos';
import { useNegocio, VERSION_APP } from '../negocio';
import { InstallButton, usePwa } from '../PwaControls';

const PALABRA = 'BORRAR';

export function Ajustes() {
  const { puede, avisar } = useApp();
  const admin = puede('bd.administrar');
  const pwa = usePwa();
  const [negocio, guardarNegocio] = useNegocio();
  const [nombre, setNombre] = useState(negocio);
  const [borrando, setBorrando] = useState(false);

  const comprobar = async () => {
    try {
      await checkForUpdate();
      avisar({ tipo: 'info', texto: 'Búsqueda terminada. Si hay una versión nueva verás el aviso para recargar.' });
    } catch {
      avisar({ tipo: 'error', texto: 'No se pudo buscar actualizaciones (¿sin conexión?).' });
    }
  };

  return (
    <>
      <Cabecera titulo="Ajustes" subtitulo="Negocio, organización, copia de seguridad y datos de la aplicación." />

      <div className="rejilla-2">
        <section className="planilla" aria-labelledby="t-negocio">
          <h2 id="t-negocio">Negocio</h2>
          <form onSubmit={(e) => { e.preventDefault(); guardarNegocio(nombre); avisar({ tipo: 'ok', texto: 'Nombre del negocio guardado.' }); }} noValidate>
            <Campo etiqueta="Nombre del negocio" ayuda="Aparece en los pedidos y órdenes de compra impresos.">
              {(p) => <input {...p} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />}
            </Campo>
            <div className="descargas-acciones"><button type="submit" className="btn btn-primario">Guardar nombre</button></div>
          </form>
        </section>

        <section className="planilla" aria-labelledby="t-app">
          <h2 id="t-app">Aplicación</h2>
          <dl className="datos-app" data-testid="info-app">
            <div><dt>Versión</dt><dd data-testid="version">{VERSION_APP}</dd></div>
            <div><dt>Instalación</dt><dd>{pwa.installed ? 'Instalada como aplicación' : pwa.canInstall ? 'Disponible para instalar' : 'Se ejecuta en el navegador'}</dd></div>
            <div><dt>Sin conexión</dt><dd>{pwa.offlineReady ? 'Lista: funciona sin internet' : 'Preparándose…'}</dd></div>
            <div><dt>Licencia</dt><dd>MIT · © 2026 Juan Esteban Olaya Muñoz</dd></div>
          </dl>
          <div className="descargas-acciones">
            <InstallButton className="btn btn-secundario" />
            <Boton onClick={() => void comprobar()}>Buscar actualizaciones</Boton>
          </div>
          <p className="nota-suave">Todos los datos quedan en este navegador (IndexedDB). No hay servidor ni se envía información a ningún sitio.</p>
        </section>
      </div>

      {puede('productos.editar') ? <Categorias /> : null}
      {admin ? <Bodegas /> : null}
      {admin ? <CopiaSeguridad /> : null}

      {admin ? (
        <section className="planilla planilla-peligro" aria-labelledby="t-borrar">
          <h2 id="t-borrar">Borrar todos los datos</h2>
          <p>Elimina de este navegador la base completa, los perfiles y los ajustes, y vuelve a la pantalla de bienvenida. No se puede deshacer: exporta una copia de seguridad antes.</p>
          <Boton variante="peligro" icono="borrar" onClick={() => setBorrando(true)}>Borrar todos los datos…</Boton>
        </section>
      ) : (
        <p className="nota-suave">Organización, copia de seguridad y borrado de datos están reservados al rol Administrador.</p>
      )}
      {borrando ? <ConfirmarBorrado onCerrar={() => setBorrando(false)} /> : null}
    </>
  );
}

function ConfirmarBorrado({ onCerrar }: { onCerrar: () => void }) {
  const { db, borrarTodo } = useApp();
  const [texto, setTexto] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (texto !== PALABRA || trabajando) return;
    setTrabajando(true);
    void borrarTodo();
  };
  return (
    <Modal titulo="Borrar todos los datos" onCerrar={onCerrar}>
      <form onSubmit={enviar} noValidate className="form-modal">
        <p>Se borrarán la base completa, los perfiles y los ajustes de este navegador. Esta acción no se puede deshacer.</p>
        <Campo etiqueta={`Escribe ${PALABRA} para confirmar`}>
          {(p) => <input {...p} data-foco autoComplete="off" autoCapitalize="characters" value={texto} onChange={(e) => setTexto(e.target.value)} />}
        </Campo>
        <div className="bienvenida-acciones">
          <Boton icono="descargar" onClick={() => descargar('bodega.sqlite', db.exportar() as unknown as BlobPart, 'application/vnd.sqlite3')}>Descargar copia antes</Boton>
          <div>
            <Boton onClick={onCerrar}>Cancelar</Boton>{' '}
            <button type="submit" className="btn btn-peligro" disabled={texto !== PALABRA || trabajando}>Borrar definitivamente</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function CopiaSeguridad() {
  const { db, avisar, sustituirBase } = useApp();
  const [error, setError] = useState<string | null>(null);
  const tam = useConsulta((c) => c.db.exportar().length);

  const importar = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      if (f.size > 40_000_000) throw new Error('El archivo supera 40 MB.');
      const bytes = new Uint8Array(await f.arrayBuffer());
      const cabecera = new TextDecoder().decode(bytes.slice(0, 15));
      if (cabecera !== 'SQLite format 3') throw new Error('El archivo no es una base SQLite válida.');
      const prueba = await abrirDesdeBytes(bytes, () => new URL('sql-wasm.wasm', document.baseURI).href);
      const tablas = new Set(prueba.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name));
      const check = prueba.escalar<string>('PRAGMA integrity_check');
      const faltan = ['productos', 'pedidos', 'movimientos', 'usuarios', 'roles'].filter((t) => !tablas.has(t));
      const admins = prueba.escalar("SELECT COUNT(*) FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'administrador' AND u.activo = 1");
      prueba.cerrar();
      if (faltan.length) throw new Error(`No parece una base de Bodega: faltan las tablas ${faltan.join(', ')}.`);
      if (check !== 'ok') throw new Error('La base importada no pasa la verificación de integridad.');
      if (admins === 0) throw new Error('La base importada no tiene ningún administrador activo.');
      avisar({ tipo: 'info', texto: `Importando ${f.name}…` });
      await sustituirBase(bytes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="planilla" aria-labelledby="t-copia">
      <h2 id="t-copia">Copia de seguridad</h2>
      <p>La base completa (catálogo, existencias, pedidos, compras, perfiles y auditoría) ocupa <b className="mono">{(tam / 1024).toFixed(0)} KB</b>. Exporta un archivo <code>.sqlite</code> para guardarla o abrirla con cualquier herramienta SQLite; importar uno reemplaza todo lo que hay ahora.</p>
      <div className="descargas-acciones">
        <Boton icono="descargar" onClick={() => { descargar('bodega.sqlite', db.exportar() as unknown as BlobPart, 'application/vnd.sqlite3'); avisar({ tipo: 'ok', texto: 'Copia descargada.' }); }}>Exportar .sqlite</Boton>
        <input id="archivo-sqlite" type="file" accept=".sqlite,.db,.sqlite3,application/vnd.sqlite3" className="sr-only" onChange={(e) => { void importar(e.target.files?.[0]); e.target.value = ''; }} />
        <label htmlFor="archivo-sqlite" className="btn btn-secundario"><Icono n="subir" tam={18} /> Importar .sqlite</label>
      </div>
      <p className="nota-suave">El archivo incluye los hashes de PIN de los perfiles: guárdalo en un lugar seguro. Los scripts para MySQL y SQL Server (sin PIN) están en la Consola SQL.</p>
      <ErrorFormulario error={error} />
    </section>
  );
}

function Categorias() {
  const { ctx, ejecutar } = useApp();
  const categorias = useConsulta((c) => listarCategoriasOrg(c));
  const [editando, setEditando] = useState<CategoriaOrg | 'nueva' | null>(null);
  const [borrando, setBorrando] = useState<CategoriaOrg | null>(null);
  return (
    <section className="planilla" aria-labelledby="t-categorias">
      <div className="planilla-cab">
        <h2 id="t-categorias">Categorías de productos <span className="contador">{categorias.length}</span></h2>
        <Boton icono="mas_" onClick={() => setEditando('nueva')}>Nueva categoría</Boton>
      </div>
      <ul className="lista-org">
        {categorias.map((c) => (
          <li key={c.id}>
            <span><b>{c.nombre}</b><small>{c.productos} {c.productos === 1 ? 'producto' : 'productos'}{c.descripcion ? ` · ${c.descripcion}` : ''}</small></span>
            <span className="acciones">
              <BotonIcono icono="editar" etiqueta={`Editar ${c.nombre}`} onClick={() => setEditando(c)} />
              <BotonIcono icono="borrar" etiqueta={`Eliminar ${c.nombre}`} onClick={() => setBorrando(c)} />
            </span>
          </li>
        ))}
      </ul>
      {editando ? <FormularioCategoria existente={editando === 'nueva' ? null : editando} onCerrar={() => setEditando(null)} /> : null}
      {borrando ? (
        <Confirmar titulo="Eliminar categoría" peligro textoBoton="Eliminar" onCerrar={() => setBorrando(null)}
          texto={`Se eliminará la categoría «${borrando.nombre}». Si tiene productos no se podrá eliminar.`}
          onConfirmar={() => ejecutar(() => eliminarCategoria(ctx, borrando.id), { ok: 'Categoría eliminada.' })} />
      ) : null}
    </section>
  );
}

function FormularioCategoria({ existente, onCerrar }: { existente: CategoriaOrg | null; onCerrar: () => void }) {
  const { ctx, ejecutar } = useApp();
  const [nombre, setNombre] = useState(existente?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(existente?.descripcion ?? '');
  const [error, setError] = useState<ErrorDominio | null>(null);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const r = ejecutar(() => guardarCategoria(ctx, { id: existente?.id, nombre, descripcion }), { ok: existente ? 'Categoría actualizada.' : 'Categoría creada.', enLinea: true });
    if (!r.ok) return setError(r.error ?? null);
    onCerrar();
  };
  return (
    <Modal titulo={existente ? 'Editar categoría' : 'Nueva categoría'} onCerrar={onCerrar}>
      <form onSubmit={enviar} noValidate className="form-modal">
        <Campo etiqueta="Nombre">{(p) => <input {...p} data-foco value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} />}</Campo>
        <Campo etiqueta="Descripción (opcional)">{(p) => <input {...p} value={descripcion} maxLength={200} onChange={(e) => setDescripcion(e.target.value)} />}</Campo>
        <ErrorFormulario error={error} />
        <div className="bienvenida-acciones"><Boton onClick={onCerrar}>Cancelar</Boton><button type="submit" className="btn btn-primario">Guardar</button></div>
      </form>
    </Modal>
  );
}

function Bodegas() {
  const bodegas = useConsulta((c) => listarBodegasOrg(c));
  const [editando, setEditando] = useState<BodegaOrg | 'nueva' | null>(null);
  return (
    <section className="planilla" aria-labelledby="t-bodegas">
      <div className="planilla-cab">
        <h2 id="t-bodegas">Bodegas <span className="contador">{bodegas.length}</span></h2>
        <Boton icono="mas_" onClick={() => setEditando('nueva')}>Nueva bodega</Boton>
      </div>
      <ul className="lista-org">
        {bodegas.map((b) => (
          <li key={b.id}>
            <span><b>{b.nombre}</b> <span className="mono">{b.codigo}</span> <Insignia estado={b.activa ? 'activo' : 'inactivo'} /><small>{b.unidades} unidades en existencia{b.ciudad ? ` · ${b.ciudad}` : ''}</small></span>
            <span className="acciones"><BotonIcono icono="editar" etiqueta={`Editar ${b.nombre}`} onClick={() => setEditando(b)} /></span>
          </li>
        ))}
      </ul>
      {editando ? <FormularioBodega existente={editando === 'nueva' ? null : editando} onCerrar={() => setEditando(null)} /> : null}
    </section>
  );
}

function FormularioBodega({ existente, onCerrar }: { existente: BodegaOrg | null; onCerrar: () => void }) {
  const { ctx, ejecutar } = useApp();
  const [codigo, setCodigo] = useState(existente?.codigo ?? '');
  const [nombre, setNombre] = useState(existente?.nombre ?? '');
  const [ciudad, setCiudad] = useState(existente?.ciudad ?? '');
  const [activa, setActiva] = useState(existente?.activa ?? true);
  const [error, setError] = useState<ErrorDominio | null>(null);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const r = ejecutar(() => guardarBodega(ctx, { id: existente?.id, codigo, nombre, ciudad, activa }), { ok: existente ? 'Bodega actualizada.' : 'Bodega creada.', enLinea: true });
    if (!r.ok) return setError(r.error ?? null);
    onCerrar();
  };
  return (
    <Modal titulo={existente ? 'Editar bodega' : 'Nueva bodega'} onCerrar={onCerrar}>
      <form onSubmit={enviar} noValidate className="form-modal">
        <Campo etiqueta="Código" ayuda="De 2 a 10 caracteres, único (por ejemplo BOG).">{(p) => <input {...p} data-foco value={codigo} maxLength={10} onChange={(e) => setCodigo(e.target.value.toUpperCase())} />}</Campo>
        <Campo etiqueta="Nombre">{(p) => <input {...p} value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} />}</Campo>
        <Campo etiqueta="Ciudad (opcional)">{(p) => <input {...p} value={ciudad} maxLength={60} onChange={(e) => setCiudad(e.target.value)} />}</Campo>
        {existente ? <label className="casilla"><input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} /> Bodega activa</label> : null}
        <ErrorFormulario error={error} />
        <div className="bienvenida-acciones"><Boton onClick={onCerrar}>Cancelar</Boton><button type="submit" className="btn btn-primario">Guardar</button></div>
      </form>
    </Modal>
  );
}
