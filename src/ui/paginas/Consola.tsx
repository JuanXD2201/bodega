import { useRef, useState } from 'react';
import { useApp, useConsulta } from '../estado';
import { ejecutarConsulta, leerEsquema, type EsquemaObjeto, type ResultadoConsulta } from '../../domain/consola';
import { generarScript, NOMBRES_SCRIPT, type Dialecto } from '../../domain/exportar';
import { abrirDesdeBytes } from '../../data/db';
import { Boton, Cabecera, ErrorFormulario, Confirmar, Pestanas } from '../componentes';
import { Icono } from '../iconos';
import { descargar } from '../fmt';

type Seccion = 'consulta' | 'esquema' | 'base';

const EJEMPLOS = [
  { t: 'Stock bajo', sql: 'SELECT sku, nombre, stock_total, stock_minimo, faltante\nFROM v_stock_bajo\nORDER BY faltante DESC;' },
  { t: 'Ventas por producto', sql: 'SELECT sku, nombre, unidades, ingresos, margen\nFROM v_ventas_producto\nORDER BY ingresos DESC\nLIMIT 10;' },
  { t: 'Mejores clientes', sql: 'SELECT nombre, pedidos, ingresos\nFROM v_ventas_cliente\nORDER BY ingresos DESC\nLIMIT 10;' },
  { t: 'Valor por bodega', sql: 'SELECT bodega, SUM(cantidad) AS unidades, SUM(valor_costo) AS valor\nFROM v_valor_inventario\nGROUP BY bodega;' },
  { t: 'Pedidos por estado', sql: 'SELECT estado, COUNT(*) AS pedidos, SUM(total) AS total\nFROM v_pedidos_totales\nGROUP BY estado;' },
  { t: 'Plan de consulta', sql: "EXPLAIN QUERY PLAN\nSELECT * FROM movimientos WHERE producto_id = 5 ORDER BY fecha DESC;" },
];

export function Consola() {
  const [seccion, setSeccion] = useState<Seccion>('consulta');
  return (
    <>
      <Cabecera titulo="Consola SQL" subtitulo="Consulta la base real en modo solo lectura, revisa el esquema y descarga los scripts." />
      <Pestanas etiqueta="Secciones de la consola" valor={seccion} onCambio={setSeccion} opciones={[
        { id: 'consulta', texto: 'Consulta' }, { id: 'esquema', texto: 'Esquema' }, { id: 'base', texto: 'Base de datos y scripts' },
      ]} />
      {seccion === 'consulta' ? <Consulta /> : null}
      {seccion === 'esquema' ? <Esquema /> : null}
      {seccion === 'base' ? <BaseDeDatos /> : null}
    </>
  );
}

function Consulta() {
  const { ctx } = useApp();
  const [sql, setSql] = useState(EJEMPLOS[0]!.sql);
  const [res, setRes] = useState<ResultadoConsulta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const ejecutar = () => {
    try {
      setRes(ejecutarConsulta(ctx, sql));
      setError(null);
    } catch (e) {
      setRes(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="consola">
      <section className="planilla" aria-labelledby="t-sql">
        <h2 id="t-sql">Consulta</h2>
        <div className="ejemplos" role="group" aria-label="Consultas de ejemplo">
          {EJEMPLOS.map((e) => <button key={e.t} type="button" className="chip" onClick={() => { setSql(e.sql); area.current?.focus(); }}>{e.t}</button>)}
        </div>
        <label htmlFor="sql-area" className="sr-only">Sentencia SQL</label>
        <textarea
          id="sql-area" ref={area} className="editor-sql mono" rows={7} spellCheck={false} value={sql} aria-describedby="sql-ayuda"
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ejecutar(); } }}
        />
        <div className="consola-barra">
          <p id="sql-ayuda" className="campo-ayuda">Solo lectura: SELECT, WITH, EXPLAIN y PRAGMA table_info. Una sentencia por ejecución. Atajo: Ctrl + Enter.</p>
          <Boton variante="primario" icono="consola" onClick={ejecutar}>Ejecutar</Boton>
        </div>
        <ErrorFormulario error={error} />
      </section>
      {res ? (
        <section className="planilla planilla-tabla" aria-labelledby="t-res" aria-live="polite">
          <div className="planilla-cab">
            <h2 id="t-res">Resultado</h2>
            <p className="planilla-sub" data-resultado-info>{res.filas.length} filas · {res.milisegundos} ms{res.truncado ? ' · mostrando las primeras 500' : ''}</p>
          </div>
          {res.columnas.length ? (
            <div className="tabla-envoltorio">
              <table className="tabla tabla-sql">
                <caption className="sr-only">Resultado de la consulta</caption>
                <thead><tr>{res.columnas.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
                <tbody>
                  {res.filas.map((f, i) => (
                    <tr key={i}>{f.map((v, k) => <td key={k} className={typeof v === 'number' ? 'num' : v === null ? 'nulo' : ''}>{v === null ? 'NULL' : String(v)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="nota-suave">La consulta no devolvió columnas.</p>}
          {!res.filas.length && res.columnas.length ? <p className="nota-suave">Sin filas.</p> : null}
        </section>
      ) : null}
    </div>
  );
}

function Esquema() {
  const objetos = useConsulta((c) => leerEsquema(c));
  const [abierto, setAbierto] = useState<string | null>('productos');
  const grupos: { titulo: string; tipo: EsquemaObjeto['tipo'] }[] = [
    { titulo: 'Tablas', tipo: 'table' }, { titulo: 'Vistas', tipo: 'view' }, { titulo: 'Triggers', tipo: 'trigger' }, { titulo: 'Índices', tipo: 'index' },
  ];
  return (
    <div className="esquema">
      {grupos.map((g) => {
        const items = objetos.filter((o) => o.tipo === g.tipo);
        return (
          <section key={g.tipo} className="planilla" aria-labelledby={`g-${g.tipo}`}>
            <h2 id={`g-${g.tipo}`}>{g.titulo} <span className="contador">{items.length}</span></h2>
            <ul className="esquema-lista">
              {items.map((o) => {
                const id = `${o.tipo}:${o.nombre}`;
                const activo = abierto === id;
                return (
                  <li key={id}>
                    <button type="button" className="esquema-item" aria-expanded={activo} onClick={() => setAbierto(activo ? null : id)}>
                      <Icono n="flecha" tam={14} className={activo ? 'girado' : ''} />
                      <span className="mono">{o.nombre}</span>
                      {o.tipo === 'trigger' || o.tipo === 'index' ? <small>en {o.tabla}</small> : <small>{o.columnas.length} columnas</small>}
                    </button>
                    {activo ? (
                      <div className="esquema-detalle">
                        {o.columnas.length ? (
                          <table className="tabla tabla-sql"><thead><tr><th scope="col">Columna</th><th scope="col">Tipo</th><th scope="col">Reglas</th></tr></thead>
                            <tbody>{o.columnas.map((c) => <tr key={c.nombre}><td className="mono">{c.nombre}</td><td className="mono">{c.tipo || '—'}</td><td>{[c.pk ? 'clave primaria' : '', c.obligatoria ? 'obligatoria' : ''].filter(Boolean).join(', ') || '—'}</td></tr>)}</tbody></table>
                        ) : null}
                        <pre className="codigo"><code>{o.sql}</code></pre>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BaseDeDatos() {
  const { ctx, db, puede, avisar, sustituirBase } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [restablecer, setRestablecer] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const admin = puede('bd.administrar');
  const tam = useConsulta((c) => c.db.exportar().length);

  const bajarScript = (d: Dialecto) => {
    descargar(NOMBRES_SCRIPT[d], '﻿' + generarScript(ctx.db, d));
    avisar({ tipo: 'ok', texto: `Descargado ${NOMBRES_SCRIPT[d]}.` });
  };
  const importar = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      if (f.size > 40_000_000) throw new Error('El archivo supera 40 MB.');
      const bytes = new Uint8Array(await f.arrayBuffer());
      const cabecera = new TextDecoder().decode(bytes.slice(0, 15));
      if (cabecera !== 'SQLite format 3') throw new Error('El archivo no es una base SQLite válida.');
      const prueba = await abrirDesdeBytes(bytes, (n) => new URL(n, document.baseURI).href);
      const tablas = new Set(prueba.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name));
      const check = prueba.escalar<string>('PRAGMA integrity_check');
      const faltan = ['productos', 'pedidos', 'movimientos', 'usuarios', 'roles'].filter((t) => !tablas.has(t));
      prueba.cerrar();
      if (faltan.length) throw new Error(`No parece una base de Bodega: faltan las tablas ${faltan.join(', ')}.`);
      if (check !== 'ok') throw new Error('La base importada no pasa la verificación de integridad.');
      await sustituirBase(bytes);
      avisar({ tipo: 'ok', texto: `Base importada desde ${f.name}.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rejilla-2">
      <section className="planilla" aria-labelledby="t-scripts">
        <h2 id="t-scripts">Scripts del esquema</h2>
        <p>Los tres dialectos tienen las mismas tablas, restricciones, triggers y vistas. Los de MySQL y SQL Server incluyen los datos de ejemplo de esta base.</p>
        <ul className="descargas">
          <li><div><b className="mono">schema.sqlite.sql</b><small>Esquema que ejecuta esta aplicación (sin datos)</small></div><Boton icono="descargar" onClick={() => bajarScript('sqlite')}>Descargar</Boton></li>
          <li><div><b className="mono">schema.mysql.sql</b><small>MySQL 8.0.16 o superior, con datos</small></div><Boton icono="descargar" onClick={() => bajarScript('mysql')}>Descargar</Boton></li>
          <li><div><b className="mono">schema.mssql.sql</b><small>SQL Server 2019 o superior, con datos</small></div><Boton icono="descargar" onClick={() => bajarScript('mssql')}>Descargar</Boton></li>
        </ul>
        <p className="nota-suave">Las diferencias de sintaxis (triggers, identidad, validaciones) están documentadas en <code>docs/MODELO_DE_DATOS.md</code>.</p>
      </section>
      <section className="planilla" aria-labelledby="t-archivo">
        <h2 id="t-archivo">Archivo de la base</h2>
        <p>La base completa ocupa <b className="mono">{(tam / 1024).toFixed(0)} KB</b> y se guarda en IndexedDB después de cada operación.</p>
        <div className="descargas-acciones">
          <Boton icono="descargar" disabled={!admin} onClick={() => descargar('bodega.sqlite', db.exportar() as unknown as BlobPart, 'application/vnd.sqlite3')}>Exportar .sqlite</Boton>
          <input id="archivo-sqlite" type="file" accept=".sqlite,.db,.sqlite3,application/vnd.sqlite3" className="sr-only" disabled={!admin} onChange={(e) => { void importar(e.target.files?.[0]); e.target.value = ''; }} />
          <label htmlFor="archivo-sqlite" className={`btn btn-secundario ${admin ? '' : 'btn-deshabilitado'}`} aria-disabled={!admin}><Icono n="subir" tam={18} /> Importar .sqlite</label>
          <Boton variante="peligro" icono="base" disabled={!admin || trabajando} onClick={() => setRestablecer(true)}>Restablecer datos de demostración</Boton>
        </div>
        {!admin ? <p className="nota-suave">Exportar, importar y restablecer están reservados al rol Administrador.</p> : null}
        <ErrorFormulario error={error} />
      </section>
      {restablecer ? (
        <Confirmar titulo="Restablecer la demostración" peligro textoBoton="Restablecer" onCerrar={() => setRestablecer(false)}
          texto="Se descartan todos los cambios y se vuelve a generar la base de ejemplo con fechas relativas a hoy. No se puede deshacer."
          onConfirmar={() => { setTrabajando(true); void sustituirBase(null).then(() => { setTrabajando(false); avisar({ tipo: 'ok', texto: 'Datos de demostración restablecidos.' }); }); }} />
      ) : null}
    </div>
  );
}
