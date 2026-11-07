import { useMemo, useState } from 'react';
import { useApp, useConsulta } from '../estado';
import {
  anularOrden, eliminarOrdenBorrador, enviarOrden, guardarOrden, listarOrdenes, obtenerOrden, recibirOrden,
  type EstadoOrden, type OrdenDetalle, type OrdenResumen,
} from '../../domain/compras';
import { listarBodegas, listarProductos } from '../../domain/catalogo';
import { listarProveedores } from '../../domain/terceros';
import { Boton, BotonIcono, Buscador, Cabecera, Campo, Confirmar, Enlace, ErrorFormulario, Insignia, Modal, Sku, Vacio, ir, useDebounce } from '../componentes';
import { TablaDatos, type Columna } from '../tabla';
import { cant, fechaCorta, pesos } from '../fmt';
import type { ErrorDominio } from '../../domain/nucleo';
import { HojaImpresion, imprimir, type DocumentoImpreso } from '../impresion';

export function Compras({ partes }: { partes: string[] }) {
  if (partes[1]) return <DetalleOrden id={partes[1] === 'nuevo' ? null : Number(partes[1])} />;
  return <ListaOrdenes />;
}

function ListaOrdenes() {
  const { puede } = useApp();
  const [q, setQ] = useState('');
  const buscar = useDebounce(q, 150);
  const [estado, setEstado] = useState<EstadoOrden | ''>('');
  const filas = useConsulta((c) => listarOrdenes(c, { q: buscar, estado }), [buscar, estado]);

  const columnas: Columna<OrdenResumen>[] = [
    { id: 'num', titulo: 'Orden', render: (o) => <Enlace a={`compras/${o.id}`} className="enlace-mono">{o.numero}</Enlace> },
    { id: 'prov', titulo: 'Proveedor', principal: true, render: (o) => <><span className="celda-titulo">{o.proveedor}</span><small className="celda-sub">Recibe en {o.bodega}</small></> },
    { id: 'fecha', titulo: 'Fecha', ocultaMovil: true, render: (o) => fechaCorta(o.fecha) },
    { id: 'avance', titulo: 'Recibido', num: true, render: (o) => <span className="cant">{cant(o.unidades_recibidas)} / {cant(o.unidades_pedidas)}</span> },
    { id: 'total', titulo: 'Total', num: true, render: (o) => <span className="cant">{pesos(o.total)}</span> },
    { id: 'estado', titulo: 'Estado', render: (o) => <Insignia estado={o.estado} /> },
  ];
  return (
    <>
      <Cabecera titulo="Órdenes de compra" subtitulo="Pedidos a proveedores con recepción parcial o total.">
        {puede('compras.gestionar') ? <Boton variante="primario" icono="mas_" data-atajo-nuevo onClick={() => ir('compras/nuevo')}>Nueva orden</Boton> : null}
      </Cabecera>
      <div className="filtros">
        <Buscador valor={q} onCambio={setQ} placeholder="Buscar por número o proveedor" />
        <label className="filtro">
          <span>Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoOrden | '')}>
            <option value="">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="enviada">Enviada</option>
            <option value="parcial">Parcial</option>
            <option value="recibida">Recibida</option>
            <option value="anulada">Anulada</option>
          </select>
        </label>
      </div>
      <section className="planilla planilla-tabla">
        {filas.length ? <TablaDatos titulo="Órdenes de compra" columnas={columnas} filas={filas} clave={(o) => o.id} /> : <Vacio titulo="No hay órdenes con estos filtros" />}
      </section>
    </>
  );
}

function DetalleOrden({ id }: { id: number | null }) {
  const { ctx, puede } = useApp();
  const orden = useConsulta((c) => {
    if (id === null) return null;
    try { return obtenerOrden(c, id); } catch { return undefined; }
  }, [id]);
  if (id !== null && orden === undefined) {
    return <Vacio titulo="Esta orden no existe" accion={<Enlace a="compras" className="btn btn-primario">Volver a compras</Enlace>} />;
  }
  if ((orden === null || orden?.estado === 'borrador') && puede('compras.gestionar')) return <FormularioOrden key={orden?.id ?? 'nueva'} existente={orden ?? null} />;
  if (!orden) return <Vacio titulo="Sin acceso" texto="Tu rol no puede crear órdenes." />;
  return <VistaOrden orden={orden} ctx={ctx} />;
}

interface LineaLocal { productoId: number; cantidad: string; costo: string }

function FormularioOrden({ existente }: { existente: OrdenDetalle | null }) {
  const { ctx, ejecutar } = useApp();
  const proveedores = useConsulta((c) => listarProveedores(c).filter((p) => p.activo || p.id === existente?.proveedor_id));
  const bodegas = useConsulta((c) => listarBodegas(c).filter((b) => b.activa));
  const productos = useConsulta((c) => listarProductos(c, { estado: 'activos' }));
  const [proveedorId, setProveedorId] = useState(existente?.proveedor_id ?? 0);
  const [bodegaId, setBodegaId] = useState(existente?.bodega_id ?? bodegas[0]?.id ?? 1);
  const [notas, setNotas] = useState(existente?.notas ?? '');
  const [lineas, setLineas] = useState<LineaLocal[]>(existente?.items.map((i) => ({ productoId: i.producto_id, cantidad: String(i.cantidad_pedida), costo: String(i.costo_unitario) })) ?? []);
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState<ErrorDominio | null>(null);
  const [eliminar, setEliminar] = useState(false);
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const resultados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (!t) return [];
    return productos
      .filter((p) => !lineas.some((l) => l.productoId === p.id) && (!proveedorId || p.proveedor_id === proveedorId || t.length > 2) && (p.sku.toLowerCase().includes(t) || p.nombre.toLowerCase().includes(t)))
      .slice(0, 6);
  }, [busqueda, productos, lineas, proveedorId]);
  const total = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0);

  const datos = () => ({ id: existente?.id, proveedorId, bodegaId, notas, lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, costoUnitario: l.costo })) });
  const guardar = (enviar: boolean) => {
    const r = ejecutar(() => {
      const idOrden = guardarOrden(ctx, datos());
      if (enviar) enviarOrden(ctx, idOrden);
      return idOrden;
    }, { ok: enviar ? 'Orden enviada al proveedor.' : 'Borrador guardado.', enLinea: true });
    if (!r.ok) setError(r.error ?? null);
    else ir(`compras/${r.valor}`);
  };

  return (
    <>
      <Cabecera titulo={existente ? `Orden ${existente.numero}` : 'Nueva orden de compra'} subtitulo="Mientras esté en borrador puedes cambiar proveedor, líneas y costos.">
        <Enlace a="compras" className="btn btn-fantasma">Volver</Enlace>
      </Cabecera>
      <ErrorFormulario error={error} />
      <div className="editor">
        <section className="planilla" aria-labelledby="t-oc">
          <h2 id="t-oc">Datos de la orden</h2>
          <div className="formulario formulario-1">
            <Campo etiqueta="Proveedor">{(p) => <select {...p} value={proveedorId} onChange={(e) => setProveedorId(Number(e.target.value))}><option value={0}>Selecciona un proveedor…</option>{proveedores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>}</Campo>
            <Campo etiqueta="Bodega de recepción">{(p) => <select {...p} value={bodegaId} onChange={(e) => setBodegaId(Number(e.target.value))}>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select>}</Campo>
            <Campo etiqueta="Notas">{(p) => <textarea {...p} rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} />}</Campo>
          </div>
        </section>
        <section className="planilla" aria-labelledby="t-ocl">
          <h2 id="t-ocl">Productos a comprar</h2>
          <div className="agregar">
            <Buscador valor={busqueda} onCambio={setBusqueda} placeholder="Agregar producto por SKU o nombre" />
            {resultados.length ? (
              <ul className="sugerencias" aria-label="Productos encontrados">
                {resultados.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => { setLineas((x) => [...x, { productoId: p.id, cantidad: String(Math.max(p.stock_minimo * 3, 1)), costo: String(p.costo) }]); setBusqueda(''); }}>
                    <Sku>{p.sku}</Sku><span>{p.nombre}</span><small className="cant">costo {pesos(p.costo)} · stock {cant(p.stock_total)}</small>
                  </button></li>
                ))}
              </ul>
            ) : null}
          </div>
          {lineas.length ? (
            <div className="tabla-envoltorio">
              <table className="tabla tabla-lineas">
                <caption className="sr-only">Líneas de la orden</caption>
                <thead><tr><th scope="col">Producto</th><th scope="col" className="num">Cantidad</th><th scope="col" className="num">Costo</th><th scope="col" className="num">Subtotal</th><th scope="col"><span className="sr-only">Quitar</span></th></tr></thead>
                <tbody>
                  {lineas.map((l, i) => {
                    const p = porId.get(l.productoId);
                    return (
                      <tr key={l.productoId}>
                        <td data-label="Producto" className="principal"><Sku>{p?.sku ?? '—'}</Sku> <span className="celda-titulo">{p?.nombre}</span></td>
                        <td data-label="Cantidad" className="num"><input className="mono entrada-num" inputMode="numeric" aria-label={`Cantidad de ${p?.sku}`} value={l.cantidad} onChange={(e) => setLineas((x) => x.map((y, k) => (k === i ? { ...y, cantidad: e.target.value.replace(/\D/g, '') } : y)))} /></td>
                        <td data-label="Costo" className="num"><input className="mono entrada-num ancha" inputMode="numeric" aria-label={`Costo de ${p?.sku}`} value={l.costo} onChange={(e) => setLineas((x) => x.map((y, k) => (k === i ? { ...y, costo: e.target.value.replace(/\D/g, '') } : y)))} /></td>
                        <td data-label="Subtotal" className="num"><span className="cant">{pesos((Number(l.cantidad) || 0) * (Number(l.costo) || 0))}</span></td>
                        <td className="col-acciones"><BotonIcono icono="cerrar" etiqueta={`Quitar ${p?.sku}`} onClick={() => setLineas((x) => x.filter((_, k) => k !== i))} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Vacio titulo="Aún no hay productos" texto="Busca un producto para agregarlo a la orden." />}
          <div className="totales"><span>{lineas.length} líneas</span><strong className="cant">{pesos(total)}</strong></div>
          <div className="barra-acciones">
            {existente ? <Boton variante="peligro" icono="borrar" onClick={() => setEliminar(true)}>Eliminar borrador</Boton> : <span />}
            <div>
              <Boton onClick={() => guardar(false)}>Guardar borrador</Boton>
              <Boton variante="primario" icono="ok" disabled={!lineas.length} onClick={() => guardar(true)}>Guardar y enviar</Boton>
            </div>
          </div>
        </section>
      </div>
      {eliminar && existente ? (
        <Confirmar titulo="Eliminar borrador" peligro textoBoton="Eliminar" texto={`Se eliminará la orden ${existente.numero}.`} onCerrar={() => setEliminar(false)}
          onConfirmar={() => { const r = ejecutar(() => eliminarOrdenBorrador(ctx, existente.id), { ok: 'Borrador eliminado.', deshacer: true }); if (r.ok) ir('compras'); }} />
      ) : null}
    </>
  );
}

function documentoOrden(o: OrdenDetalle): DocumentoImpreso {
  return {
    tipo: 'Orden de compra',
    numero: o.numero,
    estado: o.estado,
    fecha: o.fecha,
    datos: [['Proveedor', o.proveedor], ['Recibe en', o.bodega]],
    columnas: [{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Cantidad', num: true }, { titulo: 'Costo unitario', num: true }, { titulo: 'Subtotal', num: true }],
    filas: o.items.map((l) => [l.sku, l.nombre, cant(l.cantidad_pedida), pesos(l.costo_unitario), pesos(l.subtotal)]),
    resumen: `${o.lineas} líneas · ${cant(o.unidades_pedidas)} unidades · Total`,
    total: pesos(o.total),
    notas: o.notas || undefined,
    firmas: ['Autorizó', 'Proveedor'],
  };
}

function VistaOrden({ orden, ctx }: { orden: OrdenDetalle; ctx: ReturnType<typeof useApp>['ctx'] }) {
  const { ejecutar, puede } = useApp();
  const [recibiendo, setRecibiendo] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const abierta = orden.estado === 'enviada' || orden.estado === 'parcial';
  const columnas: Columna<OrdenDetalle['items'][number]>[] = [
    { id: 'sku', titulo: 'SKU', render: (l) => <Sku>{l.sku}</Sku> },
    { id: 'nombre', titulo: 'Producto', principal: true, render: (l) => l.nombre },
    { id: 'pedida', titulo: 'Pedida', num: true, render: (l) => <span className="cant">{cant(l.cantidad_pedida)}</span> },
    { id: 'recibida', titulo: 'Recibida', num: true, render: (l) => <span className="cant">{cant(l.cantidad_recibida)}</span> },
    { id: 'pend', titulo: 'Pendiente', num: true, render: (l) => <span className={`cant ${l.pendiente > 0 && orden.estado !== 'anulada' ? 'txt-aviso' : 'txt-suave'}`}>{cant(l.pendiente)}</span> },
    { id: 'costo', titulo: 'Costo', num: true, ocultaMovil: true, render: (l) => <span className="cant">{pesos(l.costo_unitario)}</span> },
    { id: 'sub', titulo: 'Subtotal', num: true, render: (l) => <span className="cant">{pesos(l.subtotal)}</span> },
  ];
  return (
    <>
      <Cabecera titulo={`Orden ${orden.numero}`} subtitulo={`${orden.proveedor} · recibe en ${orden.bodega} · creada el ${fechaCorta(orden.fecha)}`}>
        <Enlace a="compras" className="btn btn-fantasma">Volver</Enlace>
        <Boton icono="imprimir" variante="secundario" onClick={imprimir} data-imprimir>Imprimir / PDF</Boton>
        <Insignia estado={orden.estado} />
      </Cabecera>
      <HojaImpresion doc={documentoOrden(orden)} />
      <section className="planilla planilla-tabla">
        <TablaDatos titulo="Líneas de la orden" columnas={columnas} filas={orden.items} clave={(l) => l.id} />
        <div className="totales"><span>{cant(orden.unidades_recibidas)} de {cant(orden.unidades_pedidas)} unidades recibidas</span><strong className="cant">{pesos(orden.total)}</strong></div>
        {orden.notas ? <p className="notas"><b>Notas:</b> {orden.notas}</p> : null}
        {(abierta && (puede('compras.recibir') || puede('compras.gestionar'))) ? (
          <div className="barra-acciones">
            {orden.estado === 'enviada' && puede('compras.gestionar') ? <Boton variante="peligro" onClick={() => setAnulando(true)}>Anular orden</Boton> : <span />}
            {puede('compras.recibir') ? <Boton variante="primario" icono="compras" onClick={() => setRecibiendo(true)}>Registrar recepción</Boton> : null}
          </div>
        ) : null}
      </section>
      {recibiendo ? <FormRecepcion orden={orden} onCerrar={() => setRecibiendo(false)} /> : null}
      {anulando ? (
        <Confirmar titulo="Anular orden" peligro textoBoton="Anular orden" texto="La orden no se podrá recibir. Una orden con recepciones parciales ya no se puede anular." onCerrar={() => setAnulando(false)}
          onConfirmar={() => ejecutar(() => anularOrden(ctx, orden.id), { ok: 'Orden anulada.', deshacer: true })} />
      ) : null}
    </>
  );
}

function FormRecepcion({ orden, onCerrar }: { orden: OrdenDetalle; onCerrar: () => void }) {
  const { ctx, ejecutar } = useApp();
  const [cantidades, setCantidades] = useState<Record<number, string>>(Object.fromEntries(orden.items.map((l) => [l.id, ''])));
  const [error, setError] = useState<ErrorDominio | null>(null);
  const total = orden.items.reduce((a, l) => a + (Number(cantidades[l.id]) || 0), 0);
  const guardar = () => {
    const r = ejecutar(() => recibirOrden(ctx, orden.id, orden.items.map((l) => ({ lineaId: l.id, cantidad: cantidades[l.id] ?? '' }))), { ok: 'Recepción registrada: el stock ya está disponible.', deshacer: true, enLinea: true });
    if (r.ok) onCerrar();
    else setError(r.error ?? null);
  };
  return (
    <Modal titulo={`Recepción · ${orden.numero}`} onCerrar={onCerrar} ancho="ancho"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" disabled={total === 0} onClick={guardar}>Recibir {total > 0 ? `${cant(total)} unidades` : ''}</Boton></>}>
      <div className="formulario-1 formulario">
        <p>Indica cuánto llegó de cada línea. Puedes recibir parte y completar después; las líneas en cero no se tocan.</p>
        <ErrorFormulario error={error} />
        <ul className="recepcion">
          {orden.items.filter((l) => l.pendiente > 0).map((l) => (
            <li key={l.id}>
              <div><Sku>{l.sku}</Sku> <span className="celda-titulo">{l.nombre}</span><small className="celda-sub">Pendiente: {cant(l.pendiente)} de {cant(l.cantidad_pedida)}</small></div>
              <div className="recepcion-campo">
                <input className="mono entrada-num" inputMode="numeric" aria-label={`Cantidad recibida de ${l.sku}`} value={cantidades[l.id]} onChange={(e) => { setCantidades((x) => ({ ...x, [l.id]: e.target.value.replace(/\D/g, '') })); setError(null); }} />
                <button type="button" className="btn btn-fantasma" onClick={() => setCantidades((x) => ({ ...x, [l.id]: String(l.pendiente) }))}>Todo</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
