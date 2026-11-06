import { useRef, useState } from 'react';
import { useApp, useConsulta } from '../estado';
import {
  eliminarProducto, exportarProductosCsv, guardarProducto, importarProductosCsv, listarCategorias, listarProductos,
  type DatosProducto, type FiltrosProductos, type ProductoFila,
} from '../../domain/catalogo';
import { listarProveedores } from '../../domain/terceros';
import { Boton, BotonIcono, Buscador, Cabecera, Campo, Confirmar, ErrorFormulario, Insignia, Modal, NivelStock, Rotulo, Sku, Vacio, useDebounce } from '../componentes';
import { TablaDatos, type Columna } from '../tabla';
import { cant, descargar, pesos } from '../fmt';
import { ErrorDominio } from '../../domain/nucleo';

export function Productos() {
  const { ejecutar, ctx, puede } = useApp();
  const [q, setQ] = useState('');
  const buscar = useDebounce(q, 150);
  const [categoriaId, setCategoriaId] = useState(0);
  const [estado, setEstado] = useState<NonNullable<FiltrosProductos['estado']>>('activos');
  const [orden, setOrden] = useState<NonNullable<FiltrosProductos['orden']>>('sku');
  const [desc, setDesc] = useState(false);
  const [editando, setEditando] = useState<ProductoFila | 'nuevo' | null>(null);
  const [borrando, setBorrando] = useState<ProductoFila | null>(null);
  const [rotulo, setRotulo] = useState<ProductoFila | null>(null);
  const [importando, setImportando] = useState(false);

  const filas = useConsulta((c) => listarProductos(c, { q: buscar, categoriaId: categoriaId || null, estado, orden, descendente: desc }), [buscar, categoriaId, estado, orden, desc]);
  const categorias = useConsulta((c) => listarCategorias(c));
  const editar = puede('productos.editar');

  const ordenar = (o: string) => {
    if (o === orden) setDesc(!desc);
    else { setOrden(o as typeof orden); setDesc(false); }
  };

  const columnas: Columna<ProductoFila>[] = [
    { id: 'sku', titulo: 'SKU', orden: 'sku', render: (p) => <Sku>{p.sku}</Sku> },
    { id: 'nombre', titulo: 'Producto', orden: 'nombre', principal: true, render: (p) => <><span className="celda-titulo">{p.nombre}</span><small className="celda-sub">{p.categoria}{p.proveedor ? ` · ${p.proveedor}` : ''}</small></> },
    { id: 'costo', titulo: 'Costo', num: true, ocultaMovil: true, render: (p) => <span className="cant">{pesos(p.costo)}</span> },
    { id: 'precio', titulo: 'Precio', num: true, orden: 'precio', render: (p) => <span className="cant">{pesos(p.precio)}</span> },
    { id: 'stock', titulo: 'Stock', num: true, orden: 'stock', render: (p) => <NivelStock stock={p.stock_total} minimo={p.stock_minimo} /> },
    { id: 'min', titulo: 'Mínimo', num: true, ocultaMovil: true, render: (p) => <span className="cant">{cant(p.stock_minimo)}</span> },
    { id: 'estado', titulo: 'Estado', ocultaMovil: true, render: (p) => <Insignia estado={p.activo ? 'activo' : 'inactivo'} /> },
    {
      id: 'acc', titulo: 'Acciones', acciones: true,
      render: (p) => (
        <span className="acciones">
          <BotonIcono icono="imprimir" etiqueta={`Ver rótulo de ${p.sku}`} onClick={() => setRotulo(p)} />
          {editar ? <BotonIcono icono="editar" etiqueta={`Editar ${p.sku}`} onClick={() => setEditando(p)} /> : null}
          {editar ? <BotonIcono icono="borrar" etiqueta={`Eliminar ${p.sku}`} onClick={() => setBorrando(p)} /> : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <Cabecera titulo="Productos" subtitulo={`${filas.length} ${filas.length === 1 ? 'producto' : 'productos'} con los filtros actuales.`}>
        <Boton icono="descargar" onClick={() => descargar('productos.csv', '﻿' + exportarProductosCsv(ctx), 'text/csv;charset=utf-8')}>Exportar CSV</Boton>
        {editar ? <Boton icono="subir" onClick={() => setImportando(true)}>Importar CSV</Boton> : null}
        {editar ? <Boton variante="primario" icono="mas_" data-atajo-nuevo onClick={() => setEditando('nuevo')}>Nuevo producto</Boton> : null}
      </Cabecera>

      <div className="filtros">
        <Buscador valor={q} onCambio={setQ} placeholder="Buscar por SKU o nombre" />
        <label className="filtro">
          <span>Categoría</span>
          <select value={categoriaId} onChange={(e) => setCategoriaId(Number(e.target.value))}>
            <option value={0}>Todas</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="filtro">
          <span>Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
            <option value="activos">Activos</option>
            <option value="bajo">Con stock bajo</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
        </label>
      </div>

      <section className="planilla planilla-tabla">
        {filas.length ? (
          <TablaDatos titulo="Productos" columnas={columnas} filas={filas} clave={(p) => p.id} orden={orden} descendente={desc} onOrden={ordenar} claseFila={(p) => (!p.activo ? 'fila-inactiva' : undefined)} />
        ) : (
          <Vacio titulo="Ningún producto coincide" texto="Prueba con otro texto o quita algún filtro." accion={<Boton onClick={() => { setQ(''); setCategoriaId(0); setEstado('todos'); }}>Limpiar filtros</Boton>} />
        )}
      </section>

      {editando ? <FormularioProducto producto={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} /> : null}
      {rotulo ? (
        <Modal titulo={`Rótulo de ${rotulo.sku}`} onCerrar={() => setRotulo(null)} pie={<Boton onClick={() => window.print()} icono="imprimir">Imprimir</Boton>}>
          <div className="rotulo-vista"><Rotulo sku={rotulo.sku} nombre={rotulo.nombre} detalle={`${rotulo.categoria} · ${pesos(rotulo.precio)} / ${rotulo.unidad}`} /></div>
        </Modal>
      ) : null}
      {borrando ? (
        <Confirmar
          titulo="Eliminar producto"
          peligro
          textoBoton="Eliminar"
          texto={<>Se eliminará <b>{borrando.sku}</b> si no tiene historial. Si ya tuvo movimientos, pedidos o compras, se desactiva para conservar la trazabilidad.</>}
          onCerrar={() => setBorrando(null)}
          onConfirmar={() => {
            const r = ejecutar(() => eliminarProducto(ctx, borrando.id), { deshacer: true });
            if (r.ok) setBorrando(null);
          }}
        />
      ) : null}
      {importando ? <ImportarCsv onCerrar={() => setImportando(false)} /> : null}
    </>
  );
}

function FormularioProducto({ producto, onCerrar }: { producto: ProductoFila | null; onCerrar: () => void }) {
  const { ejecutar, ctx } = useApp();
  const categorias = useConsulta((c) => listarCategorias(c));
  const proveedores = useConsulta((c) => listarProveedores(c).filter((p) => p.activo || p.id === producto?.proveedor_id));
  const [v, setV] = useState({
    sku: producto?.sku ?? '', nombre: producto?.nombre ?? '', descripcion: producto?.descripcion ?? '',
    categoriaId: producto?.categoria_id ?? categorias[0]?.id ?? 0, proveedorId: producto?.proveedor_id ?? 0,
    unidad: producto?.unidad ?? 'und', costo: String(producto?.costo ?? ''), precio: String(producto?.precio ?? ''),
    stockMinimo: String(producto?.stock_minimo ?? '0'), activo: producto ? producto.activo === 1 : true,
  });
  const [error, setError] = useState<ErrorDominio | null>(null);
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((a) => ({ ...a, [k]: x }));
  const margen = Number(v.precio) > 0 && Number(v.costo) >= 0 && v.precio !== '' ? Math.round(((Number(v.precio) - Number(v.costo)) / Number(v.precio)) * 100) : null;

  const guardar = () => {
    const datos: DatosProducto = { ...v, id: producto?.id, proveedorId: v.proveedorId || null };
    const r = ejecutar(() => guardarProducto(ctx, datos), { ok: producto ? 'Producto actualizado.' : 'Producto creado.', enLinea: true });
    if (r.ok) onCerrar();
    else setError(r.error ?? null);
  };

  return (
    <Modal
      titulo={producto ? `Editar ${producto.sku}` : 'Nuevo producto'}
      onCerrar={onCerrar}
      ancho="ancho"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" onClick={guardar}>Guardar producto</Boton></>}
    >
      <form className="formulario" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
        <ErrorFormulario error={error} />
        <Campo etiqueta="SKU" ayuda="Letras mayúsculas, números y guiones. Ej.: HER-1001">
          {(p) => <input {...p} className="mono" value={v.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} maxLength={20} autoComplete="off" />}
        </Campo>
        <Campo etiqueta="Nombre" className="span-2">{(p) => <input {...p} value={v.nombre} onChange={(e) => set('nombre', e.target.value)} maxLength={120} />}</Campo>
        <Campo etiqueta="Categoría">
          {(p) => <select {...p} value={v.categoriaId} onChange={(e) => set('categoriaId', Number(e.target.value))}>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>}
        </Campo>
        <Campo etiqueta="Proveedor habitual">
          {(p) => <select {...p} value={v.proveedorId} onChange={(e) => set('proveedorId', Number(e.target.value))}><option value={0}>Sin proveedor</option>{proveedores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>}
        </Campo>
        <Campo etiqueta="Unidad">{(p) => <input {...p} value={v.unidad} onChange={(e) => set('unidad', e.target.value)} maxLength={12} />}</Campo>
        <Campo etiqueta="Costo (COP)">{(p) => <input {...p} inputMode="numeric" className="mono" value={v.costo} onChange={(e) => set('costo', e.target.value.replace(/\D/g, ''))} />}</Campo>
        <Campo etiqueta="Precio de venta (COP)" ayuda={margen === null ? undefined : `Margen bruto: ${margen}%`}>
          {(p) => <input {...p} inputMode="numeric" className="mono" value={v.precio} onChange={(e) => set('precio', e.target.value.replace(/\D/g, ''))} />}
        </Campo>
        <Campo etiqueta="Stock mínimo" ayuda="Debajo de este total aparece en alertas.">
          {(p) => <input {...p} inputMode="numeric" className="mono" value={v.stockMinimo} onChange={(e) => set('stockMinimo', e.target.value.replace(/\D/g, ''))} />}
        </Campo>
        <Campo etiqueta="Descripción" className="span-2">{(p) => <textarea {...p} rows={2} value={v.descripcion} onChange={(e) => set('descripcion', e.target.value)} maxLength={400} />}</Campo>
        <label className="casilla span-2">
          <input type="checkbox" checked={v.activo} onChange={(e) => set('activo', e.target.checked)} />
          Producto activo (aparece en pedidos y compras)
        </label>
      </form>
    </Modal>
  );
}

function ImportarCsv({ onCerrar }: { onCerrar: () => void }) {
  const { ejecutar, ctx } = useApp();
  const [texto, setTexto] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<ErrorDominio | null>(null);
  const [cargando, setCargando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const leer = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) { setError(new ErrorDominio('El archivo supera 2 MB.')); return; }
    setCargando(true);
    setNombre(f.name);
    setTexto(await f.text());
    setError(null);
    setCargando(false);
  };
  const importar = () => {
    const r = ejecutar(() => importarProductosCsv(ctx, texto), {
      enLinea: true,
      deshacer: true,
      ok: (x: { creados: number; actualizados: number }) => `Importación lista: ${x.creados} productos nuevos y ${x.actualizados} actualizados.`,
    });
    if (r.ok) onCerrar();
    else setError(r.error ?? null);
  };
  return (
    <Modal titulo="Importar productos desde CSV" onCerrar={onCerrar} ancho="ancho"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" disabled={!texto || cargando} onClick={importar}>Importar</Boton></>}>
      <div className="formulario formulario-1">
        <p>El archivo debe tener encabezado con al menos las columnas <code>sku, nombre, categoria, costo, precio</code>; opcionales: <code>proveedor, unidad, stock_minimo, activo</code>. Si el SKU ya existe se actualiza. La importación es todo o nada.</p>
        <input ref={entrada} type="file" accept=".csv,text/csv" className="sr-only" id="archivo-csv" onChange={(e) => void leer(e.target.files?.[0])} />
        <label htmlFor="archivo-csv" className="btn btn-secundario subir"><span>Elegir archivo CSV</span></label>
        {nombre ? <p className="mono">{nombre} · {texto.split('\n').length - 1} filas</p> : null}
        <Campo etiqueta="…o pega el contenido">
          {(p) => <textarea {...p} rows={6} className="mono" value={texto} onChange={(e) => { setTexto(e.target.value); setError(null); }} placeholder={'sku,nombre,categoria,costo,precio\nHER-2001,Martillo de goma,Herramientas manuales,12000,17500'} spellCheck={false} />}
        </Campo>
        <ErrorFormulario error={error} />
      </div>
    </Modal>
  );
}
