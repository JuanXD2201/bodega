import { createPortal } from 'react-dom';
import { aTexto } from '../domain/nucleo';
import { fechaHora } from './fmt';
import { useNegocio } from './negocio';

export interface DocumentoImpreso {
  /** «Pedido» u «Orden de compra». */
  tipo: string;
  numero: string;
  estado: string;
  fecha: string;
  /** Pares etiqueta/valor del encabezado (cliente, bodega, vendedor…). */
  datos: [string, string][];
  columnas: { titulo: string; num?: boolean }[];
  filas: string[][];
  /** Texto del resumen y total en pesos ya formateado. */
  resumen: string;
  total: string;
  notas?: string;
  /** Líneas de firma al pie, p. ej. «Entregó» y «Recibió». */
  firmas: string[];
}

/**
 * Hoja imprimible del documento. Vive en #impresion, fuera de la aplicación: en pantalla
 * está oculta y al imprimir (o «Guardar como PDF») es lo único que se ve.
 */
export function HojaImpresion({ doc }: { doc: DocumentoImpreso }) {
  const [negocio] = useNegocio();
  const destino = document.getElementById('impresion');
  if (!destino) return null;
  return createPortal(
    <article className="hoja" aria-label={`${doc.tipo} ${doc.numero} para imprimir`} data-hoja-impresion>
      <header className="hoja-cabecera">
        <div>
          <p className="hoja-negocio">{negocio}</p>
          <h1>{doc.tipo} {doc.numero}</h1>
        </div>
        <dl className="hoja-meta">
          <div><dt>Estado</dt><dd>{doc.estado}</dd></div>
          <div><dt>Fecha</dt><dd>{fechaHora(doc.fecha)}</dd></div>
        </dl>
      </header>
      <dl className="hoja-datos">
        {doc.datos.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <table className="hoja-tabla">
        <thead>
          <tr>{doc.columnas.map((c) => <th key={c.titulo} scope="col" className={c.num ? 'num' : ''}>{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {doc.filas.map((f, i) => (
            <tr key={i}>{f.map((v, j) => <td key={j} className={doc.columnas[j]?.num ? 'num' : ''}>{v}</td>)}</tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={Math.max(1, doc.columnas.length - 1)}>{doc.resumen}</td><td className="num"><strong>{doc.total}</strong></td></tr>
        </tfoot>
      </table>
      {doc.notas ? <p className="hoja-notas"><strong>Notas:</strong> {doc.notas}</p> : null}
      <div className="hoja-firmas">
        {doc.firmas.map((f) => <div key={f}><span /> {f}</div>)}
      </div>
      <footer className="hoja-pie">Generado desde {negocio} el {fechaHora(aTexto(new Date()))}</footer>
    </article>,
    destino,
  );
}

/** Abre el cuadro de impresión del navegador (desde ahí también se guarda como PDF). */
export const imprimir = () => window.print();
