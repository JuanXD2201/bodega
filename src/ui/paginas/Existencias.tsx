import { useState } from 'react';
import { useApp, useConsulta } from '../estado';
import { ajustarStock, matrizExistencias, MOTIVOS_AJUSTE, stockEn, trasladarStock, type FilaExistencia } from '../../domain/inventario';
import { Boton, BotonIcono, Buscador, Cabecera, Campo, ErrorFormulario, Modal, NivelStock, Sku, Vacio, useDebounce } from '../componentes';
import { TablaDatos, type Columna } from '../tabla';
import { cant } from '../fmt';
import type { ErrorDominio } from '../../domain/nucleo';

export function Existencias() {
  const { puede } = useApp();
  const [q, setQ] = useState('');
  const buscar = useDebounce(q, 150);
  const [soloBajo, setSoloBajo] = useState(false);
  const [modal, setModal] = useState<{ tipo: 'ajuste' | 'traslado'; fila: FilaExistencia } | null>(null);
  const { bodegas, filas } = useConsulta((c) => matrizExistencias(c, { q: buscar, soloBajo }), [buscar, soloBajo]);
  const acciones = puede('existencias.ajustar') || puede('existencias.trasladar');

  const columnas: Columna<FilaExistencia>[] = [
    { id: 'sku', titulo: 'SKU', render: (f) => <Sku>{f.sku}</Sku> },
    { id: 'nombre', titulo: 'Producto', principal: true, render: (f) => <><span className="celda-titulo">{f.nombre}</span><small className="celda-sub">{f.categoria}</small></> },
    ...bodegas.map<Columna<FilaExistencia>>((b) => ({
      id: b.codigo, titulo: b.codigo, num: true,
      render: (f) => <span className={`cant ${(f.por_bodega[b.codigo] ?? 0) === 0 ? 'txt-suave' : ''}`}>{cant(f.por_bodega[b.codigo] ?? 0)}</span>,
    })),
    { id: 'total', titulo: 'Total', num: true, render: (f) => <NivelStock stock={f.stock_total} minimo={f.stock_minimo} /> },
    { id: 'min', titulo: 'Mínimo', num: true, ocultaMovil: true, render: (f) => <span className="cant">{cant(f.stock_minimo)}</span> },
    ...(acciones
      ? [{
          id: 'acc', titulo: 'Acciones', acciones: true,
          render: (f: FilaExistencia) => (
            <span className="acciones">
              {puede('existencias.ajustar') ? <BotonIcono icono="editar" etiqueta={`Ajustar ${f.sku}`} onClick={() => setModal({ tipo: 'ajuste', fila: f })} /> : null}
              {puede('existencias.trasladar') ? <BotonIcono icono="traslado" etiqueta={`Trasladar ${f.sku}`} onClick={() => setModal({ tipo: 'traslado', fila: f })} /> : null}
            </span>
          ),
        } satisfies Columna<FilaExistencia>]
      : []),
  ];

  return (
    <>
      <Cabecera titulo="Existencias" subtitulo="Cantidad por producto y bodega. Cada cambio queda registrado en el libro de movimientos." />
      <div className="filtros">
        <Buscador valor={q} onCambio={setQ} placeholder="Buscar por SKU o nombre" />
        <label className="casilla">
          <input type="checkbox" checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} />
          Solo bajo el mínimo
        </label>
      </div>
      <section className="planilla planilla-tabla">
        {filas.length ? <TablaDatos titulo="Existencias por bodega" columnas={columnas} filas={filas} clave={(f) => f.producto_id} /> : <Vacio titulo="Sin resultados" texto="No hay productos que coincidan con la búsqueda." />}
      </section>
      {modal?.tipo === 'ajuste' ? <FormAjuste fila={modal.fila} onCerrar={() => setModal(null)} /> : null}
      {modal?.tipo === 'traslado' ? <FormTraslado fila={modal.fila} onCerrar={() => setModal(null)} /> : null}
    </>
  );
}

function FormAjuste({ fila, onCerrar }: { fila: FilaExistencia; onCerrar: () => void }) {
  const { ejecutar, ctx } = useApp();
  const bodegas = useConsulta((c) => matrizExistencias(c).bodegas);
  const [bodegaId, setBodegaId] = useState(bodegas[0]?.id ?? 1);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState<string>('conteo');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<ErrorDominio | null>(null);
  const actual = useConsulta((c) => stockEn(c, fila.producto_id, bodegaId), [bodegaId, fila.producto_id]);
  const delta = Number(cantidad);
  const resultado = Number.isInteger(delta) && cantidad !== '' && cantidad !== '-' ? actual + delta : null;

  const guardar = () => {
    const r = ejecutar(() => ajustarStock(ctx, { productoId: fila.producto_id, bodegaId, cantidad, motivo, nota }), { ok: `Ajuste registrado para ${fila.sku}.`, deshacer: true, enLinea: true });
    if (r.ok) onCerrar();
    else setError(r.error ?? null);
  };
  return (
    <Modal titulo={`Ajustar ${fila.sku}`} onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" onClick={guardar}>Registrar ajuste</Boton></>}>
      <form className="formulario" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
        <p className="span-2">{fila.nombre}</p>
        <ErrorFormulario error={error} />
        <Campo etiqueta="Bodega">{(p) => <select {...p} value={bodegaId} onChange={(e) => setBodegaId(Number(e.target.value))}>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select>}</Campo>
        <Campo etiqueta="Motivo">{(p) => <select {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)}>{MOTIVOS_AJUSTE.map((m) => <option key={m} value={m}>{m[0]!.toUpperCase() + m.slice(1)}</option>)}</select>}</Campo>
        <Campo etiqueta="Cantidad a sumar o restar" ayuda={resultado === null ? 'Usa un valor negativo para restar. Ej.: -3' : `Actual: ${actual} → quedará en ${resultado}`}
          error={resultado !== null && resultado < 0 ? `Quedaría en ${resultado}: no puede ser negativo.` : undefined}>
          {(p) => <input {...p} className="mono" inputMode="numeric" value={cantidad} onChange={(e) => { setCantidad(e.target.value.replace(/[^\d-]/g, '')); setError(null); }} />}
        </Campo>
        <Campo etiqueta="Nota (opcional)">{(p) => <input {...p} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} />}</Campo>
      </form>
    </Modal>
  );
}

function FormTraslado({ fila, onCerrar }: { fila: FilaExistencia; onCerrar: () => void }) {
  const { ejecutar, ctx } = useApp();
  const bodegas = useConsulta((c) => matrizExistencias(c).bodegas);
  const conStock = bodegas.find((b) => (fila.por_bodega[b.codigo] ?? 0) > 0) ?? bodegas[0]!;
  const [origenId, setOrigenId] = useState(conStock.id);
  const [destinoId, setDestinoId] = useState(bodegas.find((b) => b.id !== conStock.id)?.id ?? 2);
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<ErrorDominio | null>(null);
  const disponible = useConsulta((c) => stockEn(c, fila.producto_id, origenId), [origenId, fila.producto_id]);
  const n = Number(cantidad);

  const guardar = () => {
    const r = ejecutar(() => trasladarStock(ctx, { productoId: fila.producto_id, origenId, destinoId, cantidad, nota }), { ok: `Traslado de ${fila.sku} registrado.`, deshacer: true, enLinea: true });
    if (r.ok) onCerrar();
    else setError(r.error ?? null);
  };
  return (
    <Modal titulo={`Trasladar ${fila.sku}`} onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" onClick={guardar}>Trasladar</Boton></>}>
      <form className="formulario" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
        <p className="span-2">{fila.nombre}</p>
        <ErrorFormulario error={error} />
        <Campo etiqueta="Desde">{(p) => <select {...p} value={origenId} onChange={(e) => setOrigenId(Number(e.target.value))}>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo} · {fila.por_bodega[b.codigo] ?? 0} u.</option>)}</select>}</Campo>
        <Campo etiqueta="Hacia" error={destinoId === origenId ? 'Debe ser otra bodega.' : undefined}>
          {(p) => <select {...p} value={destinoId} onChange={(e) => setDestinoId(Number(e.target.value))}>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select>}
        </Campo>
        <Campo etiqueta="Cantidad" ayuda={`Disponible en origen: ${disponible}`} error={n > disponible ? `Solo hay ${disponible} en la bodega de origen.` : undefined}>
          {(p) => <input {...p} className="mono" inputMode="numeric" value={cantidad} onChange={(e) => { setCantidad(e.target.value.replace(/\D/g, '')); setError(null); }} />}
        </Campo>
        <Campo etiqueta="Nota (opcional)">{(p) => <input {...p} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} />}</Campo>
      </form>
    </Modal>
  );
}
