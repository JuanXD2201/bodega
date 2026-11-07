import { useMemo, useState } from 'react';
import { useApp, useConsulta } from '../estado';
import {
  anularPedido, confirmarPedido, despacharPedido, eliminarBorrador, guardarPedido, listarPedidos, obtenerPedido,
  type EstadoPedido, type PedidoDetalle, type PedidoResumen,
} from '../../domain/pedidos';
import { listarProductos, listarBodegas } from '../../domain/catalogo';
import { listarClientes } from '../../domain/terceros';
import { Boton, BotonIcono, Buscador, Cabecera, Campo, Confirmar, Enlace, ErrorFormulario, Insignia, Sku, Vacio, ir, useDebounce } from '../componentes';
import { TablaDatos, type Columna } from '../tabla';
import { cant, fechaCorta, fechaHora, pesos } from '../fmt';
import type { ErrorDominio } from '../../domain/nucleo';
import { Icono } from '../iconos';
import { HojaImpresion, imprimir, type DocumentoImpreso } from '../impresion';

export function Pedidos({ partes }: { partes: string[] }) {
  if (partes[1]) return <EditorPedido id={partes[1] === 'nuevo' ? null : Number(partes[1])} />;
  return <ListaPedidos />;
}

function ListaPedidos() {
  const { puede } = useApp();
  const [q, setQ] = useState('');
  const buscar = useDebounce(q, 150);
  const [estado, setEstado] = useState<EstadoPedido | ''>('');
  const filas = useConsulta((c) => listarPedidos(c, { q: buscar, estado }), [buscar, estado]);

  const columnas: Columna<PedidoResumen>[] = [
    { id: 'num', titulo: 'Pedido', render: (p) => <Enlace a={`pedidos/${p.id}`} className="enlace-mono">{p.numero}</Enlace> },
    { id: 'cliente', titulo: 'Cliente', principal: true, render: (p) => <><span className="celda-titulo">{p.cliente}</span><small className="celda-sub">{p.vendedor} · {p.bodega}</small></> },
    { id: 'fecha', titulo: 'Fecha', ocultaMovil: true, render: (p) => fechaCorta(p.fecha) },
    { id: 'lineas', titulo: 'Líneas', num: true, ocultaMovil: true, render: (p) => <span className="cant">{p.lineas}</span> },
    { id: 'unidades', titulo: 'Unidades', num: true, ocultaMovil: true, render: (p) => <span className="cant">{cant(p.unidades)}</span> },
    { id: 'total', titulo: 'Total', num: true, render: (p) => <span className="cant">{pesos(p.total)}</span> },
    { id: 'estado', titulo: 'Estado', render: (p) => <Insignia estado={p.estado} /> },
  ];

  return (
    <>
      <Cabecera titulo="Pedidos de venta" subtitulo={`${filas.length} pedidos con los filtros actuales.`}>
        {puede('pedidos.crear') ? <Boton variante="primario" icono="mas_" data-atajo-nuevo onClick={() => ir('pedidos/nuevo')}>Nuevo pedido</Boton> : null}
      </Cabecera>
      <div className="filtros">
        <Buscador valor={q} onCambio={setQ} placeholder="Buscar por número o cliente" />
        <label className="filtro">
          <span>Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoPedido | '')}>
            <option value="">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="confirmado">Confirmado</option>
            <option value="despachado">Despachado</option>
            <option value="anulado">Anulado</option>
          </select>
        </label>
      </div>
      <section className="planilla planilla-tabla">
        {filas.length ? <TablaDatos titulo="Pedidos de venta" columnas={columnas} filas={filas} clave={(p) => p.id} /> : <Vacio titulo="No hay pedidos con estos filtros" texto="Cambia el estado o la búsqueda, o crea un pedido nuevo." />}
      </section>
    </>
  );
}

interface LineaLocal { productoId: number; cantidad: string; precio: string }

function EditorPedido({ id }: { id: number | null }) {
  const { ctx, ejecutar, puede, usuario } = useApp();
  const existente = useConsulta((c) => {
    if (id === null) return null;
    try { return obtenerPedido(c, id); } catch { return undefined; }
  }, [id]);

  if (id !== null && existente === undefined) {
    return <Vacio titulo="Este pedido no existe" texto="Puede haberse eliminado." accion={<Enlace a="pedidos" className="btn btn-primario">Volver a pedidos</Enlace>} />;
  }
  const editable = existente === null
    ? puede('pedidos.crear')
    : !!existente && existente.estado === 'borrador' && puede('pedidos.crear') && (usuario.rol === 'administrador' || existente.usuario_id === usuario.id);
  return editable
    ? <FormularioPedido key={existente?.id ?? 'nuevo'} existente={existente ?? null} />
    : <DetallePedido pedido={existente!} ctx={ctx} ejecutar={ejecutar} />;
}

function FormularioPedido({ existente }: { existente: PedidoDetalle | null }) {
  const { ctx, ejecutar } = useApp();
  const clientes = useConsulta((c) => listarClientes(c).filter((x) => x.activo || x.id === existente?.cliente_id));
  const bodegas = useConsulta((c) => listarBodegas(c).filter((b) => b.activa));
  const productos = useConsulta((c) => listarProductos(c, { estado: 'activos' }));
  const [clienteId, setClienteId] = useState(existente?.cliente_id ?? 0);
  const [bodegaId, setBodegaId] = useState(existente?.bodega_id ?? bodegas[0]?.id ?? 1);
  const [notas, setNotas] = useState(existente?.notas ?? '');
  const [lineas, setLineas] = useState<LineaLocal[]>(existente?.items.map((i) => ({ productoId: i.producto_id, cantidad: String(i.cantidad), precio: String(i.precio_unitario) })) ?? []);
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState<ErrorDominio | null>(null);
  const [confirmando, setConfirmando] = useState<'eliminar' | null>(null);

  const disponibles = useConsulta((c) => new Map(c.db.all<{ producto_id: number; cantidad: number }>('SELECT producto_id, cantidad FROM existencias WHERE bodega_id = ?', [bodegaId]).map((e) => [e.producto_id, e.cantidad])), [bodegaId]);
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const resultados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (!t) return [];
    return productos.filter((p) => !lineas.some((l) => l.productoId === p.id) && (p.sku.toLowerCase().includes(t) || p.nombre.toLowerCase().includes(t))).slice(0, 6);
  }, [busqueda, productos, lineas]);

  const total = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0);
  const unidades = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0), 0);
  const sinStock = lineas.filter((l) => (Number(l.cantidad) || 0) > (disponibles.get(l.productoId) ?? 0));

  const agregar = (productoId: number) => {
    const p = porId.get(productoId)!;
    setLineas((x) => [...x, { productoId, cantidad: '1', precio: String(p.precio) }]);
    setBusqueda('');
    setError(null);
  };
  const cambiar = (i: number, campo: 'cantidad' | 'precio', v: string) => setLineas((x) => x.map((l, k) => (k === i ? { ...l, [campo]: v.replace(/\D/g, '') } : l)));

  const datos = () => ({ id: existente?.id, clienteId, bodegaId, notas, lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, precioUnitario: l.precio })) });
  const guardar = (): number | null => {
    const r = ejecutar(() => guardarPedido(ctx, datos()), { ok: existente ? 'Borrador actualizado.' : 'Borrador guardado.', enLinea: true });
    if (!r.ok) { setError(r.error ?? null); return null; }
    setError(null);
    return r.valor!;
  };
  const guardarYSalir = () => {
    const nuevo = guardar();
    if (nuevo) ir(`pedidos/${nuevo}`);
  };
  const confirmar = () => {
    const nuevo = guardar();
    if (!nuevo) return;
    const r = ejecutar(() => confirmarPedido(ctx, nuevo), { ok: 'Pedido confirmado: el stock se descontó de la bodega.', deshacer: true });
    // Si falla (p. ej. sin stock) el aviso explica el motivo y el borrador queda guardado.
    ir(`pedidos/${nuevo}`);
    void r;
  };

  return (
    <>
      <Cabecera titulo={existente ? `Pedido ${existente.numero}` : 'Nuevo pedido'} subtitulo={existente ? `Borrador creado el ${fechaHora(existente.fecha)} por ${existente.vendedor}.` : 'Se guarda como borrador hasta que lo confirmes.'}>
        <Enlace a="pedidos" className="btn btn-fantasma">Volver</Enlace>
      </Cabecera>
      <ErrorFormulario error={error} />
      <div className="editor">
        <section className="planilla" aria-labelledby="t-datos">
          <h2 id="t-datos">Datos del pedido</h2>
          <div className="formulario formulario-1">
            <Campo etiqueta="Cliente">
              {(p) => (
                <select {...p} value={clienteId} onChange={(e) => setClienteId(Number(e.target.value))}>
                  <option value={0}>Selecciona un cliente…</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
            </Campo>
            <Campo etiqueta="Bodega de despacho" ayuda="El stock se descuenta de esta bodega al confirmar.">
              {(p) => <select {...p} value={bodegaId} onChange={(e) => setBodegaId(Number(e.target.value))}>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select>}
            </Campo>
            <Campo etiqueta="Notas">{(p) => <textarea {...p} rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} />}</Campo>
          </div>
        </section>

        <section className="planilla" aria-labelledby="t-lineas">
          <h2 id="t-lineas">Productos del pedido</h2>
          <div className="agregar">
            <Buscador valor={busqueda} onCambio={setBusqueda} placeholder="Agregar producto por SKU o nombre" />
            {resultados.length ? (
              <ul className="sugerencias" aria-label="Productos encontrados">
                {resultados.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => agregar(p.id)}>
                      <Sku>{p.sku}</Sku>
                      <span>{p.nombre}</span>
                      <small className="cant">{pesos(p.precio)} · {cant(disponibles.get(p.id) ?? 0)} disp.</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : busqueda.trim() ? <p className="campo-ayuda">Sin coincidencias entre los productos activos que aún no están en el pedido.</p> : null}
          </div>

          {lineas.length ? (
            <div className="tabla-envoltorio">
              <table className="tabla tabla-lineas">
                <caption className="sr-only">Líneas del pedido</caption>
                <thead>
                  <tr><th scope="col">Producto</th><th scope="col" className="num">Disp.</th><th scope="col" className="num">Cantidad</th><th scope="col" className="num">Precio</th><th scope="col" className="num">Subtotal</th><th scope="col"><span className="sr-only">Quitar</span></th></tr>
                </thead>
                <tbody>
                  {lineas.map((l, i) => {
                    const p = porId.get(l.productoId);
                    const disp = disponibles.get(l.productoId) ?? 0;
                    const falta = (Number(l.cantidad) || 0) > disp;
                    return (
                      <tr key={l.productoId} className={falta ? 'fila-alerta' : undefined}>
                        <td data-label="Producto" className="principal"><Sku>{p?.sku ?? '—'}</Sku> <span className="celda-titulo">{p?.nombre}</span></td>
                        <td data-label="Disponible" className="num"><span className={`cant ${falta ? 'txt-error' : ''}`}>{cant(disp)}</span></td>
                        <td data-label="Cantidad" className="num"><input className="mono entrada-num" inputMode="numeric" aria-label={`Cantidad de ${p?.sku}`} value={l.cantidad} onChange={(e) => cambiar(i, 'cantidad', e.target.value)} /></td>
                        <td data-label="Precio" className="num"><input className="mono entrada-num ancha" inputMode="numeric" aria-label={`Precio de ${p?.sku}`} value={l.precio} onChange={(e) => cambiar(i, 'precio', e.target.value)} /></td>
                        <td data-label="Subtotal" className="num"><span className="cant">{pesos((Number(l.cantidad) || 0) * (Number(l.precio) || 0))}</span></td>
                        <td className="col-acciones"><BotonIcono icono="cerrar" etiqueta={`Quitar ${p?.sku}`} onClick={() => setLineas((x) => x.filter((_, k) => k !== i))} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Vacio titulo="Aún no hay productos" texto="Busca un producto arriba para agregarlo al pedido." />}

          {sinStock.length ? (
            <p className="nota-alerta" role="status">
              <Icono n="alerta" tam={18} />
              {sinStock.length === 1 ? 'Una línea supera' : `${sinStock.length} líneas superan`} el stock de la bodega seleccionada. Puedes guardar el borrador, pero no podrás confirmarlo hasta ajustar las cantidades o trasladar existencias.
            </p>
          ) : null}

          <div className="totales">
            <span>{lineas.length} {lineas.length === 1 ? 'línea' : 'líneas'} · {cant(unidades)} unidades</span>
            <strong className="cant">{pesos(total)}</strong>
          </div>
          <div className="barra-acciones">
            {existente ? <Boton variante="peligro" icono="borrar" onClick={() => setConfirmando('eliminar')}>Eliminar borrador</Boton> : <span />}
            <div>
              <Boton onClick={guardarYSalir}>Guardar borrador</Boton>
              <Boton variante="primario" icono="ok" onClick={confirmar} disabled={!lineas.length}>Confirmar pedido</Boton>
            </div>
          </div>
        </section>
      </div>
      {confirmando && existente ? (
        <Confirmar titulo="Eliminar borrador" peligro textoBoton="Eliminar" texto={`Se eliminará el borrador ${existente.numero} con sus líneas.`} onCerrar={() => setConfirmando(null)}
          onConfirmar={() => { const r = ejecutar(() => eliminarBorrador(ctx, existente.id), { ok: 'Borrador eliminado.', deshacer: true }); if (r.ok) ir('pedidos'); }} />
      ) : null}
    </>
  );
}

function documentoPedido(p: PedidoDetalle): DocumentoImpreso {
  return {
    tipo: 'Pedido',
    numero: p.numero,
    estado: p.estado,
    fecha: p.fecha,
    datos: [['Cliente', p.cliente], ['Bodega', p.bodega], ['Vendedor', p.vendedor]],
    columnas: [{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Cantidad', num: true }, { titulo: 'Precio', num: true }, { titulo: 'Subtotal', num: true }],
    filas: p.items.map((l) => [l.sku, l.nombre, `${cant(l.cantidad)} ${l.unidad}`, pesos(l.precio_unitario), pesos(l.subtotal)]),
    resumen: `${p.lineas} líneas · ${cant(p.unidades)} unidades · Total`,
    total: pesos(p.total),
    notas: p.notas || undefined,
    firmas: ['Despachó', 'Recibió conforme'],
  };
}

function DetallePedido({ pedido, ctx, ejecutar }: { pedido: PedidoDetalle; ctx: ReturnType<typeof useApp>['ctx']; ejecutar: ReturnType<typeof useApp>['ejecutar'] }) {
  const { puede, usuario } = useApp();
  const [accion, setAccion] = useState<'anular' | 'despachar' | null>(null);
  const propio = usuario.rol === 'administrador' || pedido.usuario_id === usuario.id;
  const puedeConfirmar = pedido.estado === 'borrador' && puede('pedidos.confirmar') && propio;
  const puedeDespachar = pedido.estado === 'confirmado' && puede('pedidos.despachar');
  const puedeAnular = (pedido.estado === 'borrador' || pedido.estado === 'confirmado') && puede('pedidos.anular') && propio;

  const columnas: Columna<PedidoDetalle['items'][number]>[] = [
    { id: 'sku', titulo: 'SKU', render: (l) => <Sku>{l.sku}</Sku> },
    { id: 'nombre', titulo: 'Producto', principal: true, render: (l) => l.nombre },
    { id: 'cant', titulo: 'Cantidad', num: true, render: (l) => <span className="cant">{cant(l.cantidad)} {l.unidad}</span> },
    { id: 'precio', titulo: 'Precio', num: true, render: (l) => <span className="cant">{pesos(l.precio_unitario)}</span> },
    { id: 'sub', titulo: 'Subtotal', num: true, render: (l) => <span className="cant">{pesos(l.subtotal)}</span> },
  ];
  const hitos = [
    { t: 'Creado', f: pedido.fecha }, { t: 'Confirmado', f: pedido.fecha_confirmacion }, { t: 'Despachado', f: pedido.fecha_despacho }, { t: 'Anulado', f: pedido.fecha_anulacion },
  ].filter((h) => h.f);

  return (
    <>
      <Cabecera titulo={`Pedido ${pedido.numero}`} subtitulo={`${pedido.cliente} · bodega ${pedido.bodega} · vendedor ${pedido.vendedor}`}>
        <Enlace a="pedidos" className="btn btn-fantasma">Volver</Enlace>
        <Boton icono="imprimir" variante="secundario" onClick={imprimir} data-imprimir>Imprimir / PDF</Boton>
        <Insignia estado={pedido.estado} />
      </Cabecera>
      <HojaImpresion doc={documentoPedido(pedido)} />
      <div className="editor">
        <section className="planilla" aria-labelledby="t-hist">
          <h2 id="t-hist">Historial</h2>
          <ol className="hitos">
            {hitos.map((h) => <li key={h.t}><b>{h.t}</b><span>{fechaHora(h.f!)}</span></li>)}
          </ol>
          {pedido.notas ? <p className="notas"><b>Notas:</b> {pedido.notas}</p> : null}
        </section>
        <section className="planilla planilla-tabla" aria-labelledby="t-items">
          <h2 id="t-items" className="planilla-titulo">Productos</h2>
          <TablaDatos titulo="Líneas del pedido" columnas={columnas} filas={pedido.items} clave={(l) => l.id} />
          <div className="totales"><span>{pedido.lineas} líneas · {cant(pedido.unidades)} unidades</span><strong className="cant">{pesos(pedido.total)}</strong></div>
          {(puedeConfirmar || puedeDespachar || puedeAnular) ? (
            <div className="barra-acciones">
              {puedeAnular ? <Boton variante="peligro" onClick={() => setAccion('anular')}>Anular pedido</Boton> : <span />}
              <div>
                {puedeConfirmar ? <Boton variante="primario" icono="ok" onClick={() => ejecutar(() => confirmarPedido(ctx, pedido.id), { ok: 'Pedido confirmado.', deshacer: true })}>Confirmar pedido</Boton> : null}
                {puedeDespachar ? <Boton variante="primario" icono="compras" onClick={() => setAccion('despachar')}>Marcar como despachado</Boton> : null}
              </div>
            </div>
          ) : pedido.estado === 'borrador' ? <p className="nota-suave">Este borrador pertenece a {pedido.vendedor}; solo su autor o un administrador puede editarlo.</p> : null}
        </section>
      </div>
      {accion === 'anular' ? (
        <Confirmar titulo="Anular pedido" peligro textoBoton="Anular pedido" onCerrar={() => setAccion(null)}
          texto={pedido.estado === 'confirmado' ? 'El stock descontado volverá a la bodega y quedará registrado en los movimientos.' : 'El borrador quedará anulado y no se podrá reabrir.'}
          onConfirmar={() => ejecutar(() => anularPedido(ctx, pedido.id), { ok: 'Pedido anulado.', deshacer: true })} />
      ) : null}
      {accion === 'despachar' ? (
        <Confirmar titulo="Despachar pedido" textoBoton="Despachar" onCerrar={() => setAccion(null)}
          texto="El pedido pasará a despachado. El stock ya se descontó al confirmarlo."
          onConfirmar={() => ejecutar(() => despacharPedido(ctx, pedido.id), { ok: 'Pedido despachado.', deshacer: true })} />
      ) : null}
    </>
  );
}
