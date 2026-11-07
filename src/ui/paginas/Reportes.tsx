import { useMemo, useState } from 'react';
import { useApp, useConsulta } from '../estado';
import {
  rotacion, stockBajo, valorInventario, ventasPorCliente, ventasPorPeriodo, ventasPorProducto, type Agrupacion,
  type FilaRotacion, type FilaStockBajo, type FilaVentaCliente, type FilaVentaProducto,
} from '../../domain/reportes';
import { escribirCsv } from '../../domain/csv';
import { soloFecha, sumarDias } from '../../domain/nucleo';
import { Boton, Cabecera, Campo, ErrorFormulario, Pestanas, Sku, Vacio } from '../componentes';
import { TablaDatos, type Columna } from '../tabla';
import { BarrasHorizontales, Dona, GraficoBarras } from '../graficos';
import { cant, descargar, pesos, pesosCortos } from '../fmt';

type Vista = 'stock' | 'rotacion' | 'ventas' | 'valor';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function etiquetaPeriodo(e: string, a: Agrupacion): string {
  if (a === 'dia') return `${Number(e.slice(8, 10))} ${MESES[Number(e.slice(5, 7)) - 1]}`;
  if (a === 'mes') return `${MESES[Number(e.slice(5, 7)) - 1]} ${e.slice(2, 4)}`;
  return `sem ${Number(e.slice(6))}`;
}

export function Reportes() {
  const [vista, setVista] = useState<Vista>('stock');
  return (
    <>
      <Cabecera titulo="Reportes" subtitulo="Cada reporte es una consulta SQL sobre las vistas y tablas de la base." />
      <Pestanas etiqueta="Tipo de reporte" valor={vista} onCambio={setVista} opciones={[
        { id: 'stock', texto: 'Stock bajo' }, { id: 'rotacion', texto: 'Rotación' }, { id: 'ventas', texto: 'Ventas' }, { id: 'valor', texto: 'Valor del inventario' },
      ]} />
      {vista === 'stock' ? <ReporteStock /> : null}
      {vista === 'rotacion' ? <ReporteRotacion /> : null}
      {vista === 'ventas' ? <ReporteVentas /> : null}
      {vista === 'valor' ? <ReporteValor /> : null}
    </>
  );
}

function Periodo({ desde, hasta, setDesde, setHasta, children }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void; children?: React.ReactNode }) {
  return (
    <div className="filtros filtros-periodo">
      <Campo etiqueta="Desde">{(p) => <input {...p} type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />}</Campo>
      <Campo etiqueta="Hasta">{(p) => <input {...p} type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />}</Campo>
      {children}
    </div>
  );
}

function usePeriodo(dias: number) {
  const hoy = useMemo(() => new Date(), []);
  const [desde, setDesde] = useState(soloFecha(sumarDias(hoy, -dias)));
  const [hasta, setHasta] = useState(soloFecha(hoy));
  return { desde, hasta, setDesde, setHasta };
}

function ReporteStock() {
  const filas = useConsulta((c) => stockBajo(c));
  const columnas: Columna<FilaStockBajo>[] = [
    { id: 'sku', titulo: 'SKU', render: (f) => <Sku>{f.sku}</Sku> },
    { id: 'nombre', titulo: 'Producto', principal: true, render: (f) => <><span className="celda-titulo">{f.nombre}</span><small className="celda-sub">{f.categoria}</small></> },
    { id: 'prov', titulo: 'Proveedor', ocultaMovil: true, render: (f) => f.proveedor ?? '—' },
    { id: 'stock', titulo: 'Stock', num: true, render: (f) => <span className={`cant ${f.stock_total === 0 ? 'txt-error' : 'txt-aviso'}`}>{cant(f.stock_total)}</span> },
    { id: 'min', titulo: 'Mínimo', num: true, render: (f) => <span className="cant">{cant(f.stock_minimo)}</span> },
    { id: 'falta', titulo: 'Faltan', num: true, render: (f) => <b className="cant">{cant(f.faltante)}</b> },
  ];
  return (
    <section className="planilla planilla-tabla">
      <div className="planilla-cab">
        <div><h2>Productos por reponer</h2><p className="planilla-sub">{filas.length} productos activos por debajo de su mínimo, del mayor faltante al menor.</p></div>
        <Boton icono="descargar" onClick={() => descargar('stock-bajo.csv', '﻿' + escribirCsv(['sku', 'producto', 'categoria', 'proveedor', 'stock', 'minimo', 'faltante'], filas.map((f) => [f.sku, f.nombre, f.categoria, f.proveedor, f.stock_total, f.stock_minimo, f.faltante])), 'text/csv;charset=utf-8')}>Exportar CSV</Boton>
      </div>
      {filas.length ? <TablaDatos titulo="Stock bajo" columnas={columnas} filas={filas} clave={(f) => f.producto_id} /> : <Vacio titulo="Todo en orden" texto="Ningún producto activo está por debajo de su stock mínimo." />}
    </section>
  );
}

function ReporteRotacion() {
  const p = usePeriodo(60);
  const resultado = useConsulta((c) => { try { return { filas: rotacion(c, p.desde, p.hasta), error: null }; } catch (e) { return { filas: [] as FilaRotacion[], error: e as Error }; } }, [p.desde, p.hasta]);
  const columnas: Columna<FilaRotacion>[] = [
    { id: 'sku', titulo: 'SKU', render: (f) => <Sku>{f.sku}</Sku> },
    { id: 'nombre', titulo: 'Producto', principal: true, render: (f) => f.nombre },
    { id: 'vend', titulo: 'Vendidas', num: true, render: (f) => <span className="cant">{cant(f.vendidas)}</span> },
    { id: 'stock', titulo: 'Stock actual', num: true, render: (f) => <span className="cant">{cant(f.stock_actual)}</span> },
    { id: 'rot', titulo: 'Rotación', num: true, render: (f) => <span className="cant">{f.rotacion === null ? '—' : f.rotacion.toFixed(2)}</span> },
    { id: 'cob', titulo: 'Cobertura', num: true, render: (f) => <span className="cant">{f.cobertura_dias === null ? 'sin ventas' : `${cant(f.cobertura_dias)} d`}</span> },
  ];
  const mas = resultado.filas.filter((f) => f.vendidas > 0).slice(0, 8);
  return (
    <>
      <Periodo {...p} />
      <ErrorFormulario error={resultado.error?.message} />
      <div className="rejilla-2">
        <section className="planilla">
          <h2>Más rotación</h2>
          <p className="planilla-sub">Unidades vendidas netas (descontando anulaciones) en el período.</p>
          {mas.length ? <BarrasHorizontales titulo="Unidades vendidas" datos={mas.map((f) => ({ etiqueta: f.nombre, valor: f.vendidas }))} formato={cant} /> : <Vacio titulo="Sin ventas en el período" />}
        </section>
        <section className="planilla">
          <h2>Cómo leerlo</h2>
          <p><b>Rotación</b> = unidades vendidas ÷ stock actual. Un valor de 1 significa que se vendió el equivalente al stock actual.</p>
          <p><b>Cobertura</b> = días que alcanza el stock actual al ritmo de venta del período.</p>
        </section>
      </div>
      <section className="planilla planilla-tabla">
        <div className="planilla-cab"><h2>Rotación por producto</h2>
          <Boton icono="descargar" onClick={() => descargar('rotacion.csv', '﻿' + escribirCsv(['sku', 'producto', 'vendidas', 'stock', 'rotacion', 'cobertura_dias'], resultado.filas.map((f) => [f.sku, f.nombre, f.vendidas, f.stock_actual, f.rotacion, f.cobertura_dias])), 'text/csv;charset=utf-8')}>Exportar CSV</Boton>
        </div>
        <TablaDatos titulo="Rotación" columnas={columnas} filas={resultado.filas} clave={(f) => f.producto_id} />
      </section>
    </>
  );
}

function ReporteVentas() {
  const p = usePeriodo(89);
  const [agrupar, setAgrupar] = useState<Agrupacion>('semana');
  const datos = useConsulta((c) => {
    try {
      return { serie: ventasPorPeriodo(c, p.desde, p.hasta, agrupar), productos: ventasPorProducto(c, p.desde, p.hasta), clientes: ventasPorCliente(c, p.desde, p.hasta), error: null };
    } catch (e) {
      return { serie: [], productos: [] as FilaVentaProducto[], clientes: [] as FilaVentaCliente[], error: e as Error };
    }
  }, [p.desde, p.hasta, agrupar]);
  const total = datos.serie.reduce((a, x) => a + x.valor, 0);
  const pedidos = datos.serie.reduce((a, x) => a + (x.extra ?? 0), 0);
  const margen = datos.productos.reduce((a, x) => a + x.margen, 0);

  const colProd: Columna<FilaVentaProducto>[] = [
    { id: 'sku', titulo: 'SKU', render: (f) => <Sku>{f.sku}</Sku> },
    { id: 'n', titulo: 'Producto', principal: true, render: (f) => f.nombre },
    { id: 'u', titulo: 'Unidades', num: true, render: (f) => <span className="cant">{cant(f.unidades)}</span> },
    { id: 'i', titulo: 'Ingresos', num: true, render: (f) => <span className="cant">{pesos(f.ingresos)}</span> },
    { id: 'm', titulo: 'Margen', num: true, ocultaMovil: true, render: (f) => <span className="cant">{pesos(f.margen)}</span> },
  ];
  const colCli: Columna<FilaVentaCliente>[] = [
    { id: 'n', titulo: 'Cliente', principal: true, render: (f) => f.nombre },
    { id: 'p', titulo: 'Pedidos', num: true, render: (f) => <span className="cant">{f.pedidos}</span> },
    { id: 'i', titulo: 'Ingresos', num: true, render: (f) => <span className="cant">{pesos(f.ingresos)}</span> },
  ];
  return (
    <>
      <Periodo {...p}>
        <label className="filtro"><span>Agrupar por</span>
          <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupacion)}><option value="dia">Día</option><option value="semana">Semana</option><option value="mes">Mes</option></select>
        </label>
      </Periodo>
      <ErrorFormulario error={datos.error?.message} />
      <section className="plaquetas plaquetas-3" aria-label="Resumen del período">
        <div className="plaqueta"><span className="plaqueta-titulo">Ventas del período</span><span className="plaqueta-valor cant">{pesosCortos(total)}</span><span className="plaqueta-nota">{pedidos} pedidos confirmados o despachados</span></div>
        <div className="plaqueta"><span className="plaqueta-titulo">Ticket promedio</span><span className="plaqueta-valor cant">{pedidos ? pesosCortos(Math.round(total / pedidos)) : '—'}</span><span className="plaqueta-nota">por pedido</span></div>
        <div className="plaqueta"><span className="plaqueta-titulo">Margen bruto estimado</span><span className="plaqueta-valor cant">{pesosCortos(margen)}</span><span className="plaqueta-nota">precio vendido menos costo actual</span></div>
      </section>
      <section className="planilla">
        <h2>Ventas por {agrupar === 'dia' ? 'día' : agrupar === 'semana' ? 'semana' : 'mes'}</h2>
        {datos.serie.length ? (
          <GraficoBarras titulo={`Ventas por ${agrupar}`} datos={datos.serie.map((s) => ({ etiqueta: etiquetaPeriodo(s.etiqueta, agrupar), valor: s.valor }))} formato={pesos} etiquetaCada={Math.ceil(datos.serie.length / 12)} />
        ) : <Vacio titulo="Sin ventas en el período" texto="Amplía el rango de fechas para ver resultados." />}
      </section>
      <div className="rejilla-2">
        <section className="planilla planilla-tabla">
          <div className="planilla-cab"><h2>Por producto</h2>
            <Boton icono="descargar" onClick={() => descargar('ventas-por-producto.csv', '﻿' + escribirCsv(['sku', 'producto', 'unidades', 'ingresos', 'margen'], datos.productos.map((f) => [f.sku, f.nombre, f.unidades, f.ingresos, f.margen])), 'text/csv;charset=utf-8')}>CSV</Boton></div>
          <TablaDatos titulo="Ventas por producto" columnas={colProd} filas={datos.productos.slice(0, 15)} clave={(f) => f.sku} />
        </section>
        <section className="planilla planilla-tabla">
          <div className="planilla-cab"><h2>Por cliente</h2>
            <Boton icono="descargar" onClick={() => descargar('ventas-por-cliente.csv', '﻿' + escribirCsv(['cliente', 'documento', 'pedidos', 'ingresos'], datos.clientes.map((f) => [f.nombre, f.documento, f.pedidos, f.ingresos])), 'text/csv;charset=utf-8')}>CSV</Boton></div>
          <TablaDatos titulo="Ventas por cliente" columnas={colCli} filas={datos.clientes.slice(0, 15)} clave={(f) => f.documento} />
        </section>
      </div>
    </>
  );
}

function ReporteValor() {
  const { puede } = useApp();
  const v = useConsulta((c) => valorInventario(c));
  return (
    <>
      <section className="plaquetas plaquetas-3" aria-label="Valor del inventario">
        <div className="plaqueta"><span className="plaqueta-titulo">Valor a costo</span><span className="plaqueta-valor cant">{pesos(v.total)}</span><span className="plaqueta-nota">{cant(v.unidades)} unidades en {v.porBodega.length} bodegas</span></div>
        <div className="plaqueta"><span className="plaqueta-titulo">Valor a precio de venta</span><span className="plaqueta-valor cant">{pesos(v.totalVenta)}</span><span className="plaqueta-nota">si se vendiera todo al precio de lista</span></div>
        <div className="plaqueta"><span className="plaqueta-titulo">Margen potencial</span><span className="plaqueta-valor cant">{v.totalVenta ? Math.round(((v.totalVenta - v.total) / v.totalVenta) * 100) : 0}%</span><span className="plaqueta-nota">sobre el precio de venta</span></div>
      </section>
      <div className="rejilla-2">
        <section className="planilla">
          <h2>Por categoría</h2>
          <Dona titulo="Valor del inventario por categoría" datos={v.porCategoria.map((c) => ({ etiqueta: c.categoria, valor: c.valor }))} formato={pesos} centro={{ valor: pesosCortos(v.total), texto: 'a costo' }} />
        </section>
        <section className="planilla">
          <h2>Por bodega</h2>
          <BarrasHorizontales titulo="Valor por bodega" datos={v.porBodega.map((b) => ({ etiqueta: b.bodega, valor: b.valor }))} formato={pesosCortos} />
          <p className="nota-suave">{puede('sql.consultar') ? 'Consulta: ' : ''}<code>SELECT bodega, SUM(valor_costo) FROM v_valor_inventario GROUP BY bodega</code></p>
        </section>
      </div>
    </>
  );
}
