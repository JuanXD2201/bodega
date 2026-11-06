import type { ReactNode } from 'react';

export interface Columna<T> {
  id: string;
  titulo: string;
  render: (fila: T) => ReactNode;
  /** Alineación numérica (derecha, mono). */
  num?: boolean;
  /** Clave de orden si la columna es ordenable. */
  orden?: string;
  /** En móvil la columna se muestra como título de la tarjeta. */
  principal?: boolean;
  /** Oculta la columna en móvil. */
  ocultaMovil?: boolean;
  /** Celda de acciones (sin etiqueta en móvil). */
  acciones?: boolean;
}

export function TablaDatos<T>({ columnas, filas, clave, titulo, orden, descendente, onOrden, claseFila }: {
  columnas: Columna<T>[];
  filas: T[];
  clave: (f: T) => string | number;
  titulo: string;
  orden?: string;
  descendente?: boolean;
  onOrden?: (o: string) => void;
  claseFila?: (f: T) => string | undefined;
}) {
  return (
    <div className="tabla-envoltorio">
      <table className="tabla">
        <caption className="sr-only">{titulo}</caption>
        <thead>
          <tr>
            {columnas.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={`${c.num ? 'num' : ''} ${c.ocultaMovil ? 'oculta-movil' : ''} ${c.acciones ? 'col-acciones' : ''}`}
                aria-sort={c.orden && orden === c.orden ? (descendente ? 'descending' : 'ascending') : undefined}
              >
                {c.orden && onOrden ? (
                  <button type="button" className="th-orden" onClick={() => onOrden(c.orden!)}>
                    {c.titulo}
                    <span aria-hidden="true">{orden === c.orden ? (descendente ? ' ▼' : ' ▲') : ''}</span>
                  </button>
                ) : (
                  c.acciones ? <span className="sr-only">{c.titulo}</span> : c.titulo
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={clave(f)} className={claseFila?.(f)}>
              {columnas.map((c) => (
                <td
                  key={c.id}
                  data-label={c.acciones ? undefined : c.titulo}
                  className={`${c.num ? 'num' : ''} ${c.principal ? 'principal' : ''} ${c.ocultaMovil ? 'oculta-movil' : ''} ${c.acciones ? 'col-acciones' : ''}`}
                >
                  {c.render(f)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
