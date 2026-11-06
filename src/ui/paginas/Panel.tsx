import { useConsulta } from '../estado';
import { panel } from '../../domain/reportes';
import { Cabecera, Enlace, Sku, Vacio } from '../componentes';
import { BarrasHorizontales, GraficoBarras } from '../graficos';
import { cant, diaMes, fechaHora, pesos, pesosCortos } from '../fmt';
import { Icono, type NombreIcono } from '../iconos';

const TIPO_MOV: Record<string, string> = {
  entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', traslado_entrada: 'Traslado (entra)', traslado_salida: 'Traslado (sale)',
};

function Plaqueta({ titulo, valor, nota, icono, alerta, a }: { titulo: string; valor: string; nota: string; icono: NombreIcono; alerta?: boolean; a?: string }) {
  const cuerpo = (
    <>
      <span className="plaqueta-icono"><Icono n={icono} tam={20} /></span>
      <span className="plaqueta-titulo">{titulo}</span>
      <span className="plaqueta-valor cant">{valor}</span>
      <span className="plaqueta-nota">{nota}</span>
    </>
  );
  return a ? <Enlace a={a} className={`plaqueta ${alerta ? 'plaqueta-alerta' : ''}`}>{cuerpo}</Enlace> : <div className={`plaqueta ${alerta ? 'plaqueta-alerta' : ''}`}>{cuerpo}</div>;
}

export function Panel() {
  const d = useConsulta((ctx) => panel(ctx));
  const delta = d.ventasPrevias30 > 0 ? Math.round(((d.ventas30 - d.ventasPrevias30) / d.ventasPrevias30) * 100) : null;
  return (
    <>
      <Cabecera titulo="Panel" subtitulo="Indicadores calculados con consultas SQL sobre la base local." />
      <section className="plaquetas" aria-label="Indicadores principales">
        <Plaqueta titulo="Valor del inventario" valor={pesosCortos(d.valorInventario)} nota={`${cant(d.unidadesEnStock)} unidades · venta potencial ${pesosCortos(d.valorVentaPotencial)}`} icono="existencias" a="reportes" />
        <Plaqueta titulo="Ventas, últimos 30 días" valor={pesosCortos(d.ventas30)} nota={`${d.pedidos30} pedidos${delta === null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta}% frente a los 30 días previos`}`} icono="reportes" a="reportes" />
        <Plaqueta titulo="Stock bajo el mínimo" valor={String(d.stockBajo)} nota={`de ${d.productosActivos} productos activos`} icono="alerta" alerta={d.stockBajo > 0} a="productos" />
        <Plaqueta titulo="Pedidos en curso" valor={String(d.pedidosPorConfirmar + d.pedidosPorDespachar)} nota={`${d.pedidosPorConfirmar} en borrador · ${d.pedidosPorDespachar} por despachar`} icono="pedidos" a="pedidos" />
        <Plaqueta titulo="Compras abiertas" valor={String(d.ordenesAbiertas)} nota="órdenes enviadas o con recepción parcial" icono="compras" a="compras" />
      </section>

      <div className="rejilla-2">
        <section className="planilla" aria-labelledby="t-ventas">
          <h2 id="t-ventas">Ventas por día</h2>
          <p className="planilla-sub">Últimos 30 días, por fecha de confirmación del pedido.</p>
          <GraficoBarras
            titulo="Ventas diarias de los últimos 30 días"
            datos={d.serieVentas.map((p) => ({ etiqueta: diaMes(p.etiqueta), valor: p.valor }))}
            formato={pesos}
            etiquetaCada={5}
          />
        </section>
        <section className="planilla" aria-labelledby="t-top">
          <h2 id="t-top">Productos que más venden</h2>
          <p className="planilla-sub">Ingresos de los últimos 30 días.</p>
          {d.topProductos.length ? (
            <BarrasHorizontales titulo="Ingresos por producto" datos={d.topProductos.map((p) => ({ etiqueta: p.nombre, valor: p.ingresos }))} formato={pesosCortos} />
          ) : <Vacio titulo="Aún no hay ventas en este período" />}
        </section>
      </div>

      <div className="rejilla-2">
        <section className="planilla" aria-labelledby="t-alertas">
          <h2 id="t-alertas">Reponer pronto</h2>
          <p className="planilla-sub">Productos por debajo de su stock mínimo.</p>
          {d.alertas.length ? (
            <ul className="lista-densa">
              {d.alertas.map((a) => (
                <li key={a.producto_id}>
                  <Sku>{a.sku}</Sku>
                  <span className="lista-nombre">{a.nombre}</span>
                  <span className={`cant ${a.stock_total === 0 ? 'txt-error' : 'txt-aviso'}`}>{a.stock_total} / {a.stock_minimo}</span>
                </li>
              ))}
            </ul>
          ) : <Vacio titulo="Todo en orden" texto="Ningún producto está por debajo de su mínimo." />}
          <Enlace a="reportes" className="enlace-pie">Ver reporte completo</Enlace>
        </section>
        <section className="planilla" aria-labelledby="t-movs">
          <h2 id="t-movs">Últimos movimientos</h2>
          <p className="planilla-sub">Lo más reciente del libro de inventario.</p>
          <ul className="lista-densa">
            {d.ultimosMovimientos.map((m) => (
              <li key={m.id}>
                <span className="mov-tipo">{TIPO_MOV[m.tipo]}</span>
                <span className="lista-nombre"><Sku>{m.sku}</Sku> <small>{m.bodega} · {fechaHora(m.fecha)}</small></span>
                <span className={`cant ${m.cantidad > 0 ? 'txt-ok' : 'txt-error'}`}>{m.cantidad > 0 ? '+' : ''}{cant(m.cantidad)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
