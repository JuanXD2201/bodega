import { useState } from 'react';
import { useApp, useConsulta } from '../estado';
import {
  eliminarCliente, eliminarProveedor, guardarCliente, guardarProveedor, listarClientes, listarProveedores,
  type Cliente, type Proveedor,
} from '../../domain/terceros';
import { Boton, BotonIcono, Buscador, Cabecera, Campo, Confirmar, ErrorFormulario, Insignia, Modal, Vacio, useDebounce } from '../componentes';
import { TablaDatos, type Columna } from '../tabla';
import { cant, pesosCortos } from '../fmt';
import type { ErrorDominio } from '../../domain/nucleo';

type Tercero = Cliente | Proveedor;

interface Config {
  singular: string;
  plural: string;
  articulo: 'el' | 'la';
  etiquetaDoc: string;
  conContacto: boolean;
  permisoEditar: 'clientes.editar' | 'proveedores.editar';
}

function documentoDe(t: Tercero) {
  return 'documento' in t ? t.documento : t.nit;
}

function Crud({ config, listar, guardar, eliminar, columnasExtra }: {
  config: Config;
  listar: (c: ReturnType<typeof useApp>['ctx'], q: string) => Tercero[];
  guardar: (c: ReturnType<typeof useApp>['ctx'], d: { id?: number; nombre: string; documento: string; contacto?: string; email?: string; telefono?: string; ciudad?: string; activo?: boolean }) => number;
  eliminar: (c: ReturnType<typeof useApp>['ctx'], id: number) => 'eliminado' | 'desactivado';
  columnasExtra: Columna<Tercero>[];
}) {
  const { ejecutar, ctx, puede } = useApp();
  const [q, setQ] = useState('');
  const buscar = useDebounce(q, 150);
  const [editando, setEditando] = useState<Tercero | 'nuevo' | null>(null);
  const [borrando, setBorrando] = useState<Tercero | null>(null);
  const filas = useConsulta((c) => listar(c, buscar), [buscar]);
  const editar = puede(config.permisoEditar);

  const columnas: Columna<Tercero>[] = [
    { id: 'nombre', titulo: 'Nombre', principal: true, render: (t) => <><span className="celda-titulo">{t.nombre}</span><small className="celda-sub">{t.email || 'Sin correo'}</small></> },
    { id: 'doc', titulo: config.etiquetaDoc, render: (t) => <span className="mono">{documentoDe(t)}</span> },
    { id: 'ciudad', titulo: 'Ciudad', ocultaMovil: true, render: (t) => t.ciudad || '—' },
    { id: 'tel', titulo: 'Teléfono', ocultaMovil: true, render: (t) => <span className="mono">{t.telefono || '—'}</span> },
    ...columnasExtra,
    { id: 'estado', titulo: 'Estado', ocultaMovil: true, render: (t) => <Insignia estado={t.activo ? 'activo' : 'inactivo'} /> },
    ...(editar ? [{
      id: 'acc', titulo: 'Acciones', acciones: true,
      render: (t: Tercero) => (
        <span className="acciones">
          <BotonIcono icono="editar" etiqueta={`Editar ${t.nombre}`} onClick={() => setEditando(t)} />
          <BotonIcono icono="borrar" etiqueta={`Eliminar ${t.nombre}`} onClick={() => setBorrando(t)} />
        </span>
      ),
    } satisfies Columna<Tercero>] : []),
  ];

  return (
    <>
      <Cabecera titulo={config.plural[0]!.toUpperCase() + config.plural.slice(1)} subtitulo={`${filas.length} registrados.`}>
        {editar ? <Boton variante="primario" icono="mas_" data-atajo-nuevo onClick={() => setEditando('nuevo')}>{config.articulo === 'el' ? 'Nuevo' : 'Nueva'} {config.singular}</Boton> : null}
      </Cabecera>
      <div className="filtros"><Buscador valor={q} onCambio={setQ} placeholder={`Buscar por nombre o ${config.etiquetaDoc.toLowerCase()}`} /></div>
      <section className="planilla planilla-tabla">
        {filas.length ? <TablaDatos titulo={config.plural} columnas={columnas} filas={filas} clave={(t) => t.id} claseFila={(t) => (!t.activo ? 'fila-inactiva' : undefined)} />
          : <Vacio titulo={`Sin ${config.plural}`} texto="No hay registros que coincidan con la búsqueda." />}
      </section>
      {editando ? (
        <Formulario config={config} tercero={editando === 'nuevo' ? null : editando} guardar={guardar} onCerrar={() => setEditando(null)} />
      ) : null}
      {borrando ? (
        <Confirmar titulo={`Eliminar ${config.singular}`} peligro textoBoton="Eliminar" onCerrar={() => setBorrando(null)}
          texto={<>Se eliminará <b>{borrando.nombre}</b>. Si ya tiene pedidos u órdenes, se desactiva para no perder el historial.</>}
          onConfirmar={() => ejecutar(() => eliminar(ctx, borrando.id), { deshacer: true, ok: `${config.singular[0]!.toUpperCase() + config.singular.slice(1)} actualizado.` })} />
      ) : null}
    </>
  );
}

function Formulario({ config, tercero, guardar, onCerrar }: {
  config: Config; tercero: Tercero | null; guardar: Parameters<typeof Crud>[0]['guardar']; onCerrar: () => void;
}) {
  const { ejecutar, ctx } = useApp();
  const [v, setV] = useState({
    nombre: tercero?.nombre ?? '', documento: tercero ? documentoDe(tercero) : '', contacto: tercero && 'contacto' in tercero ? tercero.contacto : '',
    email: tercero?.email ?? '', telefono: tercero?.telefono ?? '', ciudad: tercero?.ciudad ?? '', activo: tercero ? tercero.activo === 1 : true,
  });
  const [error, setError] = useState<ErrorDominio | null>(null);
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((a) => ({ ...a, [k]: x }));
  const enviar = () => {
    const r = ejecutar(() => guardar(ctx, { ...v, id: tercero?.id }), { ok: tercero ? 'Cambios guardados.' : `${config.singular[0]!.toUpperCase() + config.singular.slice(1)} creado.`, enLinea: true });
    if (r.ok) onCerrar();
    else setError(r.error ?? null);
  };
  return (
    <Modal titulo={tercero ? `Editar ${tercero.nombre}` : `${config.articulo === 'el' ? 'Nuevo' : 'Nueva'} ${config.singular}`} onCerrar={onCerrar} ancho="ancho"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" onClick={enviar}>Guardar</Boton></>}>
      <form className="formulario" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <ErrorFormulario error={error} />
        <Campo etiqueta="Nombre o razón social" className="span-2">{(p) => <input {...p} value={v.nombre} onChange={(e) => set('nombre', e.target.value)} maxLength={120} />}</Campo>
        <Campo etiqueta={config.etiquetaDoc}>{(p) => <input {...p} className="mono" value={v.documento} onChange={(e) => set('documento', e.target.value)} maxLength={30} />}</Campo>
        {config.conContacto ? <Campo etiqueta="Persona de contacto">{(p) => <input {...p} value={v.contacto} onChange={(e) => set('contacto', e.target.value)} maxLength={80} />}</Campo> : <Campo etiqueta="Ciudad">{(p) => <input {...p} value={v.ciudad} onChange={(e) => set('ciudad', e.target.value)} maxLength={60} />}</Campo>}
        <Campo etiqueta="Correo electrónico">{(p) => <input {...p} type="email" value={v.email} onChange={(e) => set('email', e.target.value)} maxLength={120} />}</Campo>
        <Campo etiqueta="Teléfono">{(p) => <input {...p} type="tel" className="mono" value={v.telefono} onChange={(e) => set('telefono', e.target.value)} maxLength={20} />}</Campo>
        {config.conContacto ? <Campo etiqueta="Ciudad">{(p) => <input {...p} value={v.ciudad} onChange={(e) => set('ciudad', e.target.value)} maxLength={60} />}</Campo> : null}
        <label className="casilla span-2"><input type="checkbox" checked={v.activo} onChange={(e) => set('activo', e.target.checked)} /> Activo</label>
      </form>
    </Modal>
  );
}

export function Clientes() {
  return (
    <Crud
      config={{ singular: 'cliente', plural: 'clientes', articulo: 'el', etiquetaDoc: 'Documento', conContacto: false, permisoEditar: 'clientes.editar' }}
      listar={listarClientes}
      guardar={guardarCliente}
      eliminar={eliminarCliente}
      columnasExtra={[
        { id: 'pedidos', titulo: 'Pedidos', num: true, ocultaMovil: true, render: (t) => <span className="cant">{cant((t as Cliente).pedidos)}</span> },
        { id: 'ingresos', titulo: 'Compras', num: true, render: (t) => <span className="cant">{pesosCortos((t as Cliente).ingresos)}</span> },
      ]}
    />
  );
}

export function Proveedores() {
  return (
    <Crud
      config={{ singular: 'proveedor', plural: 'proveedores', articulo: 'el', etiquetaDoc: 'NIT', conContacto: true, permisoEditar: 'proveedores.editar' }}
      listar={listarProveedores}
      guardar={guardarProveedor}
      eliminar={eliminarProveedor}
      columnasExtra={[{ id: 'productos', titulo: 'Productos', num: true, render: (t) => <span className="cant">{cant((t as Proveedor).productos)}</span> }]}
    />
  );
}
