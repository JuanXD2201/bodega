import { useId } from 'react';

interface Punto { etiqueta: string; valor: number }

/** Escala "agradable" para el eje: devuelve el máximo redondeado y los pasos. */
function escala(max: number, pasos = 4): { tope: number; marcas: number[] } {
  if (max <= 0) return { tope: 1, marcas: [0, 1] };
  const bruto = max / pasos;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((p) => p >= bruto) ?? mag * 10;
  const tope = paso * pasos;
  return { tope, marcas: Array.from({ length: pasos + 1 }, (_, i) => i * paso) };
}

const corto = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
export const ejeCorto = (n: number) => corto.format(n);

function Tabla({ datos, formato, titulo }: { datos: Punto[]; formato: (n: number) => string; titulo: string }) {
  return (
    <details className="grafico-datos">
      <summary>Ver datos de «{titulo}»</summary>
      <table>
        <tbody>
          {datos.map((d, i) => (
            <tr key={i}><th scope="row">{d.etiqueta}</th><td className="cant">{formato(d.valor)}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function GraficoBarras({ datos, titulo, formato, formatoEje = ejeCorto, etiquetaCada = 1, altura = 220 }: {
  datos: Punto[]; titulo: string; formato: (n: number) => string; formatoEje?: (n: number) => string; etiquetaCada?: number; altura?: number;
}) {
  const id = useId();
  const W = 680;
  const m = { t: 12, r: 8, b: 28, l: 46 };
  const { tope, marcas } = escala(Math.max(0, ...datos.map((d) => d.valor)));
  const h = altura - m.t - m.b;
  const paso = (W - m.l - m.r) / Math.max(datos.length, 1);
  const ancho = Math.max(2, Math.min(28, paso * 0.68));
  const maxIdx = datos.reduce((a, d, i) => (d.valor > (datos[a]?.valor ?? 0) ? i : a), 0);
  return (
    <figure className="grafico">
      <svg viewBox={`0 0 ${W} ${altura}`} role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{titulo}. Valor máximo: {formato(datos[maxIdx]?.valor ?? 0)} ({datos[maxIdx]?.etiqueta ?? '—'}).</title>
        {marcas.map((v) => {
          const y = m.t + h - (v / tope) * h;
          return (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} className={v === 0 ? 'eje-base' : 'rejilla'} />
              <text x={m.l - 8} y={y + 4} textAnchor="end" className="eje-txt">{formatoEje(v)}</text>
            </g>
          );
        })}
        {datos.map((d, i) => {
          const alto = (d.valor / tope) * h;
          const x = m.l + paso * i + (paso - ancho) / 2;
          return (
            <g key={i}>
              <rect x={x} y={m.t + h - alto} width={ancho} height={Math.max(alto, d.valor > 0 ? 1 : 0)} className={i === maxIdx ? 'barra barra-max' : 'barra'}>
                <title>{`${d.etiqueta}: ${formato(d.valor)}`}</title>
              </rect>
              {i % etiquetaCada === 0 ? (
                <text x={x + ancho / 2} y={altura - 8} textAnchor="middle" className="eje-txt">{d.etiqueta}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <Tabla datos={datos} formato={formato} titulo={titulo} />
    </figure>
  );
}

export function BarrasHorizontales({ datos, titulo, formato }: { datos: Punto[]; titulo: string; formato: (n: number) => string }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  return (
    <figure className="grafico">
      <ul className="hbarras" aria-label={titulo}>
        {datos.map((d, i) => (
          <li key={i}>
            <span className="hb-et" title={d.etiqueta}>{d.etiqueta}</span>
            <span className="hb-pista" aria-hidden="true"><i style={{ width: `${(d.valor / max) * 100}%` }} /></span>
            <span className="hb-val cant">{formato(d.valor)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

const COLORES = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)', 'var(--g5)', 'var(--g6)', 'var(--g7)', 'var(--g8)'];

export function Dona({ datos, titulo, formato, centro }: { datos: Punto[]; titulo: string; formato: (n: number) => string; centro?: { valor: string; texto: string } }) {
  const total = datos.reduce((a, d) => a + d.valor, 0) || 1;
  const R = 70;
  const C = 2 * Math.PI * R;
  let acumulado = 0;
  return (
    <figure className="grafico dona">
      <svg viewBox="0 0 180 180" role="img" aria-label={`${titulo}: ${datos.map((d) => `${d.etiqueta} ${Math.round((d.valor / total) * 100)}%`).join(', ')}`}>
        <g transform="rotate(-90 90 90)">
          {datos.map((d, i) => {
            const largo = (d.valor / total) * C;
            const el = (
              <circle key={i} cx="90" cy="90" r={R} fill="none" stroke={COLORES[i % COLORES.length]} strokeWidth="26" strokeDasharray={`${Math.max(largo - 1.5, 0)} ${C}`} strokeDashoffset={-acumulado}>
                <title>{`${d.etiqueta}: ${formato(d.valor)}`}</title>
              </circle>
            );
            acumulado += largo;
            return el;
          })}
        </g>
        {centro ? (
          <>
            <text x="90" y="88" textAnchor="middle" className="dona-valor">{centro.valor}</text>
            <text x="90" y="106" textAnchor="middle" className="dona-texto">{centro.texto}</text>
          </>
        ) : null}
      </svg>
      <ul className="leyenda">
        {datos.map((d, i) => (
          <li key={i}>
            <i style={{ background: COLORES[i % COLORES.length] }} aria-hidden="true" />
            <span>{d.etiqueta}</span>
            <b className="cant">{Math.round((d.valor / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </figure>
  );
}
