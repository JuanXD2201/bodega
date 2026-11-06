import { useEffect, useState } from 'react';
import { useConsulta } from '../estado';
import { listarMovimientos, type MovimientoFila } from '../../domain/inventario';
import { listarBodegas } from '../../domain/catalogo';
import { Boton, Buscador, Cabecera, Campo, Sku, Vacio, useDebounce } from '../componentes';
import { TablaDatos, type Columna } from '../tabla';
import { cant, fechaHora } from '../fmt';

const TIPOS: Record<string, string> = {
  entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', traslado_entrada: 'Traslado · entrada', traslado_salida: 'Traslado · salida',
};
const REFS: Record<string, string> = { pedido: 'Pedido', compra: 'Compra', traslado: 'Traslado', ajuste: 'Ajuste' };
const POR_PAGINA = 40;

export function Auditoria() {
  const [q, setQ] = useState('');
  const buscar = useDebounce(q, 200);
  const [tipo, setTipo] = useState('');
  const [bodegaId, setBodegaId] = useState(0);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const bodegas = useConsulta((c) => listarBodegas(c));
  const { filas, total } = useConsulta((c) => listarMovimientos(c, { q: buscar, tipo, bodegaId: bodegaId || null, desde, hasta, pagina, porPagina: POR_PAGINA }), [buscar, tipo, bodegaId, desde, hasta, pagina]);
  useEffect(() => setPagina(1), [buscar, tipo, bodegaId, desde, hasta]);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const columnas: Columna<MovimientoFila>[] = [
    { id: 'fecha', titulo: 'Fecha', render: (m) => <span className="mono">{fechaHora(m.fecha)}</span> },
    { id: 'tipo', titulo: 'Tipo', render: (m) => <span className={`etiqueta-tipo tipo-${m.tipo.split('_')[0]}`}>{TIPOS[m.tipo]}</span> },
    { id: 'prod', titulo: 'Producto', principal: true, render: (m) => <><Sku>{m.sku}</Sku> <span className="celda-titulo">{m.producto}</span></> },
    { id: 'bod', titulo: 'Bodega', render: (m) => <span className="mono">{m.bodega}</span> },
    { id: 'cant', titulo: 'Cantidad', num: true, render: (m) => <span className={`cant ${m.cantidad > 0 ? 'txt-ok' : 'txt-error'}`}>{m.cantidad > 0 ? '+' : ''}{cant(m.cantidad)}</span> },
    { id: 'ref', titulo: 'Origen', ocultaMovil: true, render: (m) => `${REFS[m.referencia_tipo]} #${m.referencia_id}` },
    { id: 'usr', titulo: 'Usuario', ocultaMovil: true, render: (m) => m.usuario },
    { id: 'nota', titulo: 'Detalle', ocultaMovil: true, render: (m) => <small className="celda-sub">{m.nota}</small> },
  ];

  return (
    <>
      <Cabecera titulo="Auditoría de movimientos" subtitulo="Libro inmutable: un trigger impide modificar o borrar cualquier movimiento." />
      <div className="filtros">
        <Buscador valor={q} onCambio={setQ} placeholder="Buscar por SKU, producto, usuario o detalle" />
        <label className="filtro"><span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="filtro"><span>Bodega</span>
          <select value={bodegaId} onChange={(e) => setBodegaId(Number(e.target.value))}><option value={0}>Todas</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.codigo}</option>)}</select>
        </label>
        <Campo etiqueta="Desde">{(p) => <input {...p} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />}</Campo>
        <Campo etiqueta="Hasta">{(p) => <input {...p} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />}</Campo>
      </div>
      <section className="planilla planilla-tabla">
        {filas.length ? <TablaDatos titulo="Movimientos de inventario" columnas={columnas} filas={filas} clave={(m) => m.id} /> : <Vacio titulo="Sin movimientos" texto="Ningún movimiento coincide con los filtros." />}
        <nav className="paginacion" aria-label="Paginación">
          <span>{total.toLocaleString('es-CO')} movimientos · página {pagina} de {paginas}</span>
          <div>
            <Boton disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</Boton>
            <Boton disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</Boton>
          </div>
        </nav>
      </section>
    </>
  );
}
