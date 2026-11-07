import { useState, type FormEvent } from 'react';
import { credencialDe, type Perfil } from '../../domain/perfiles';
import { esperaTrasFallos } from '../../domain/intentos';
import { verificarPin } from '../../domain/pin';
import { ETIQUETA_ROL, type Usuario } from '../../domain/nucleo';
import type { PropiedadesAcceso } from '../estado';
import { Boton, CodigoBarras } from '../componentes';
import { Icono, Marca } from '../iconos';

const DESCRIPCION_ROL = {
  administrador: 'Catálogo, compras, terceros, auditoría, perfiles y administración de la base.',
  vendedor: 'Crea y confirma sus pedidos y gestiona clientes.',
  bodeguero: 'Despacha, ajusta, traslada existencias y recibe compras.',
} as const;

interface Intentos { fallos: number; hasta: number }
const claveIntentos = (id: number) => `bodega.intentos.${id}`;
function leerIntentos(id: number): Intentos {
  try {
    return JSON.parse(sessionStorage.getItem(claveIntentos(id)) ?? '') as Intentos;
  } catch {
    return { fallos: 0, hasta: 0 };
  }
}

/** Selector de perfil local. Si el perfil tiene PIN, se pide y se verifica contra su hash. */
export function Acceso({ db, perfiles, entrar }: PropiedadesAcceso) {
  const [pidiendo, setPidiendo] = useState<Perfil | null>(null);
  const elegir = (p: Perfil) => (p.tienePin ? setPidiendo(p) : entrar(p as Usuario));

  return (
    <main className="acceso">
      <div className="acceso-franja" aria-hidden="true" />
      <section className="acceso-panel">
        <div className="acceso-marca">
          <Marca tam={44} />
          <div>
            <h1>Bodega</h1>
            <p>Inventario, compras y pedidos</p>
          </div>
        </div>
        {pidiendo ? (
          <FormularioPin db={db} perfil={pidiendo} onAtras={() => setPidiendo(null)} onEntrar={() => entrar(pidiendo as Usuario)} />
        ) : (
          <>
            <h2>¿Con qué perfil quieres entrar?</h2>
            <ul className="acceso-lista">
              {perfiles.map((u) => (
                <li key={u.id}>
                  <button type="button" className="acceso-usuario" onClick={() => elegir(u)} data-usuario={u.rol} data-perfil={u.nombre}>
                    <span className="acceso-avatar" aria-hidden="true">{u.nombre.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                    <span>
                      <b>{u.nombre}{u.tienePin ? <span className="acceso-candado"> · con PIN</span> : null}</b>
                      <small>{ETIQUETA_ROL[u.rol]} · {DESCRIPCION_ROL[u.rol]}</small>
                    </span>
                    <Icono n={u.tienePin ? 'candado' : 'flecha'} tam={18} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="nota-suave">Control de acceso local de este navegador: los perfiles limitan lo que cada rol puede hacer en la aplicación. No hay servidor ni cuentas en línea.</p>
          </>
        )}
      </section>
      <aside className="acceso-lateral" aria-hidden="true">
        <CodigoBarras semilla="bodega" alto={90} ancho={300} decorativo />
        <p>SQLite en WebAssembly · todos los datos quedan en tu navegador</p>
      </aside>
    </main>
  );
}

function FormularioPin({ db, perfil, onAtras, onEntrar }: { db: PropiedadesAcceso['db']; perfil: Perfil; onAtras: () => void; onEntrar: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [verificando, setVerificando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const previo = leerIntentos(perfil.id);
    const restante = previo.hasta - Date.now();
    if (restante > 0) {
      setError(`Demasiados intentos. Espera ${Math.ceil(restante / 1000)} s e inténtalo de nuevo.`);
      return;
    }
    const cred = credencialDe(db, perfil.id);
    if (!cred) return onEntrar();
    setVerificando(true);
    const ok = await verificarPin(pin, cred).catch(() => false);
    setVerificando(false);
    if (ok) {
      sessionStorage.removeItem(claveIntentos(perfil.id));
      return onEntrar();
    }
    const fallos = previo.fallos + 1;
    const espera = esperaTrasFallos(fallos);
    sessionStorage.setItem(claveIntentos(perfil.id), JSON.stringify({ fallos, hasta: espera ? Date.now() + espera : 0 }));
    setPin('');
    setError(espera ? `PIN incorrecto. Espera ${Math.ceil(espera / 1000)} s antes de volver a intentarlo.` : 'PIN incorrecto.');
  };

  return (
    <form onSubmit={enviar} className="acceso-pin" noValidate>
      <h2>PIN de {perfil.nombre}</h2>
      <p className="nota-suave">{ETIQUETA_ROL[perfil.rol]}</p>
      <label htmlFor="pin-acceso">PIN</label>
      <input id="pin-acceso" type="password" inputMode="numeric" autoComplete="off" maxLength={8} data-foco autoFocus value={pin} aria-invalid={error ? true : undefined} aria-describedby={error ? 'pin-error' : undefined} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }} />
      {error ? <p className="campo-msg" id="pin-error" role="alert">{error}</p> : null}
      <div className="bienvenida-acciones">
        <Boton onClick={onAtras} disabled={verificando}>Elegir otro perfil</Boton>
        <button type="submit" className="btn btn-primario" disabled={pin.length < 4 || verificando}>{verificando ? 'Verificando…' : 'Entrar'}</button>
      </div>
    </form>
  );
}
