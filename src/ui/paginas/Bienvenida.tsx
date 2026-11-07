import { useState, type FormEvent } from 'react';
import { validarPin } from '../../domain/pin';
import type { ErrorDominio } from '../../domain/nucleo';
import type { AccionesBienvenida } from '../estado';
import { Boton, Campo, CodigoBarras, ErrorFormulario } from '../componentes';
import { Icono, Marca } from '../iconos';
import { NEGOCIO_POR_DEFECTO } from '../negocio';

/** Primera ejecución: el usuario elige cómo empezar. La decisión queda guardada con la base. */
export function Bienvenida({ acciones }: { acciones: AccionesBienvenida }) {
  const [modo, setModo] = useState<'elegir' | 'vacia'>('elegir');
  const [nombre, setNombre] = useState('');
  const [negocio, setNegocio] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [errores, setErrores] = useState<{ nombre?: string; pin?: string; pin2?: string }>({});
  const [error, setError] = useState<ErrorDominio | string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    const nuevos: typeof errores = {};
    if (nombre.trim().length < 2) nuevos.nombre = 'Escribe tu nombre (al menos 2 caracteres).';
    if (pin) {
      const motivo = validarPin(pin);
      if (motivo) nuevos.pin = motivo;
      else if (pin !== pin2) nuevos.pin2 = 'Los dos PIN no coinciden.';
    }
    setErrores(nuevos);
    if (Object.keys(nuevos).length) return;
    setTrabajando(true);
    setError(null);
    try {
      await acciones.vacia(nombre, pin || null, negocio || NEGOCIO_POR_DEFECTO);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTrabajando(false);
    }
  };

  return (
    <main className="acceso bienvenida">
      <div className="acceso-franja" aria-hidden="true" />
      <section className="acceso-panel" aria-labelledby="bienvenida-titulo">
        <div className="acceso-marca">
          <Marca tam={44} />
          <div>
            <h1 id="bienvenida-titulo">Bienvenido a Bodega</h1>
            <p>Inventario, compras y pedidos</p>
          </div>
        </div>
        <p className="bienvenida-lead">
          Una base de datos SQLite real que vive en este navegador: productos, existencias por bodega, pedidos, órdenes de compra y auditoría de cada movimiento. Funciona sin conexión y se puede instalar como aplicación.
        </p>

        {modo === 'elegir' ? (
          <>
            <h2>¿Cómo quieres empezar?</h2>
            <div className="bienvenida-opciones">
              <button type="button" className="bienvenida-opcion bienvenida-opcion-principal" onClick={() => setModo('vacia')} data-testid="empezar-vacio">
                <Icono n="base" tam={22} />
                <span><b>Empezar con una base vacía</b><small>Creas tu perfil de administrador y registras tu propio catálogo, bodegas y terceros.</small></span>
                <Icono n="flecha" tam={18} />
              </button>
              <button type="button" className="bienvenida-opcion" onClick={() => void acciones.ejemplo()} data-testid="cargar-ejemplo">
                <Icono n="productos" tam={22} />
                <span><b>Cargar datos de ejemplo</b><small>64 productos, 150 pedidos, órdenes de compra y cinco perfiles de distintos roles para explorar la aplicación. Se pueden borrar desde Ajustes.</small></span>
                <Icono n="flecha" tam={18} />
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={crear} noValidate className="bienvenida-form">
            <h2>Tu perfil de administrador</h2>
            <Campo etiqueta="Tu nombre" error={errores.nombre}>
              {(p) => <input {...p} data-foco value={nombre} maxLength={60} autoComplete="name" onChange={(e) => setNombre(e.target.value)} />}
            </Campo>
            <Campo etiqueta="Nombre del negocio (opcional)" ayuda="Aparece en los pedidos y órdenes de compra que imprimas.">
              {(p) => <input {...p} value={negocio} maxLength={80} placeholder={NEGOCIO_POR_DEFECTO} onChange={(e) => setNegocio(e.target.value)} />}
            </Campo>
            <Campo etiqueta="PIN (opcional)" error={errores.pin} ayuda="De 4 a 8 dígitos. Pedirá el PIN al entrar con este perfil.">
              {(p) => <input {...p} type="password" inputMode="numeric" autoComplete="new-password" value={pin} maxLength={8} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
            </Campo>
            {pin ? (
              <Campo etiqueta="Repite el PIN" error={errores.pin2}>
                {(p) => <input {...p} type="password" inputMode="numeric" autoComplete="new-password" value={pin2} maxLength={8} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />}
              </Campo>
            ) : null}
            <ErrorFormulario error={error} />
            <div className="bienvenida-acciones">
              <Boton onClick={() => setModo('elegir')} disabled={trabajando}>Volver</Boton>
              <button type="submit" className="btn btn-primario" disabled={trabajando}>{trabajando ? 'Creando la base…' : 'Crear la base y entrar'}</button>
            </div>
          </form>
        )}
        <p className="nota-suave">Los perfiles y el PIN son un control de acceso local del navegador: no hay servidor ni cuentas en línea.</p>
      </section>
      <aside className="acceso-lateral" aria-hidden="true">
        <CodigoBarras semilla="bodega" alto={90} ancho={300} decorativo />
        <p>SQLite en WebAssembly · todos los datos quedan en tu navegador</p>
      </aside>
    </main>
  );
}
