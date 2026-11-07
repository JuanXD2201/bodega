import { useMemo, useState } from 'react';
import { buscarGlobal, ETIQUETA_TIPO, type ResultadoBusqueda, type TipoResultado } from '../domain/busqueda';
import { useApp } from './estado';
import { ir, Modal, useDebounce } from './componentes';
import { Icono } from './iconos';

const ORDEN: TipoResultado[] = ['producto', 'pedido', 'orden', 'cliente', 'proveedor'];

/** Búsqueda global (Ctrl + K): productos, pedidos, órdenes, clientes y proveedores según el rol. */
export function BusquedaGlobal({ onCerrar }: { onCerrar: () => void }) {
  const { ctx, version } = useApp();
  const [q, setQ] = useState('');
  const consulta = useDebounce(q, 120);
  const resultados = useMemo(() => buscarGlobal(ctx, consulta), [ctx, consulta, version]);
  const grupos = ORDEN.map((t) => ({ tipo: t, items: resultados.filter((r) => r.tipo === t) })).filter((g) => g.items.length);

  const abrir = (r: ResultadoBusqueda) => {
    onCerrar();
    ir(r.ruta);
  };

  return (
    <Modal titulo="Buscar en todo" onCerrar={onCerrar} ancho="ancho">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const primero = resultados[0];
          if (primero) abrir(primero);
        }}
      >
        <div className="buscador buscador-global">
          <Icono n="buscar" tam={18} />
          <input type="search" data-foco value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, producto, cliente, proveedor, N.º de pedido u orden" aria-label="Buscar en todo" />
        </div>
      </form>
      <div className="busqueda-resultados" aria-live="polite">
        {q.trim().length < 2 ? <p className="nota-suave">Escribe al menos 2 caracteres. Enter abre el primer resultado.</p> : null}
        {q.trim().length >= 2 && consulta === q && grupos.length === 0 ? <p className="nota-suave" data-sin-resultados>Sin resultados para «{q.trim()}».</p> : null}
        {grupos.map((g) => (
          <section key={g.tipo} aria-label={ETIQUETA_TIPO[g.tipo]}>
            <h3>{ETIQUETA_TIPO[g.tipo]}</h3>
            <ul>
              {g.items.map((r) => (
                <li key={`${r.tipo}-${r.id}`}>
                  <button type="button" className="resultado" onClick={() => abrir(r)} data-resultado={r.tipo}>
                    <b>{r.titulo}</b>
                    <small>{r.detalle}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
