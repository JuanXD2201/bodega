import { useState, type FormEvent } from 'react';
import { cambiarMiPin, credencialDe, eliminarPerfil, guardarPerfil, listarPerfiles, ROLES_VALIDOS, type Perfil } from '../../domain/perfiles';
import { crearCredencial, validarPin, verificarPin, type Credencial } from '../../domain/pin';
import { ETIQUETA_ROL, type ErrorDominio, type Rol } from '../../domain/nucleo';
import { useApp, useConsulta } from '../estado';
import { Boton, BotonIcono, Cabecera, Campo, Confirmar, ErrorFormulario, Insignia, Modal } from '../componentes';
import { TablaDatos, type Columna } from '../tabla';

type ModoPin = 'mantener' | 'nuevo' | 'quitar';

export function Perfiles() {
  const { ctx, puede, usuario, ejecutar } = useApp();
  const admin = puede('perfiles.administrar');
  const perfiles = useConsulta((c) => (admin ? listarPerfiles(c) : []));
  const [editando, setEditando] = useState<Perfil | 'nuevo' | null>(null);
  const [borrando, setBorrando] = useState<Perfil | null>(null);
  const [cambiandoPin, setCambiandoPin] = useState(false);
  const propio = useConsulta((c) => c.db.get<{ pin_hash: string | null }>('SELECT pin_hash FROM usuarios WHERE id = ?', [c.usuario.id]));

  const columnas: Columna<Perfil>[] = [
    { id: 'nombre', titulo: 'Nombre', principal: true, render: (p) => <><span className="celda-titulo">{p.nombre}{p.id === usuario.id ? ' (tú)' : ''}</span></> },
    { id: 'rol', titulo: 'Rol', render: (p) => ETIQUETA_ROL[p.rol] },
    { id: 'pin', titulo: 'PIN', render: (p) => (p.tienePin ? 'Con PIN' : 'Sin PIN') },
    { id: 'estado', titulo: 'Estado', render: (p) => <Insignia estado={p.activo ? 'activo' : 'inactivo'} /> },
    {
      id: 'acc', titulo: 'Acciones', acciones: true,
      render: (p) => (
        <span className="acciones">
          <BotonIcono icono="editar" etiqueta={`Editar ${p.nombre}`} onClick={() => setEditando(p)} />
          <BotonIcono icono="borrar" etiqueta={`Eliminar ${p.nombre}`} onClick={() => setBorrando(p)} />
        </span>
      ),
    },
  ];

  return (
    <>
      <Cabecera titulo="Perfiles" subtitulo="Quién puede entrar a esta base y qué rol tiene. Es control de acceso local de este navegador.">
        <Boton icono="candado" onClick={() => setCambiandoPin(true)} data-cambiar-pin>{propio?.pin_hash ? 'Cambiar mi PIN' : 'Poner un PIN a mi perfil'}</Boton>
        {admin ? <Boton variante="primario" icono="mas_" onClick={() => setEditando('nuevo')} data-atajo-nuevo>Nuevo perfil</Boton> : null}
      </Cabecera>

      {admin ? (
        <section className="planilla planilla-tabla">
          <TablaDatos titulo="Perfiles de acceso" columnas={columnas} filas={perfiles} clave={(p) => p.id} />
        </section>
      ) : (
        <section className="planilla">
          <h2>Tu perfil</h2>
          <p><b>{usuario.nombre}</b> · {ETIQUETA_ROL[usuario.rol]}</p>
          <p className="nota-suave">Solo un administrador puede crear, editar o desactivar perfiles. Tú puedes cambiar tu propio PIN.</p>
        </section>
      )}

      <section className="planilla">
        <h2>Qué protege y qué no</h2>
        <ul className="lista-simple">
          <li>Cada rol solo ve y hace lo que le corresponde dentro de la aplicación, y los permisos se comprueban en la lógica de negocio.</li>
          <li>El PIN se guarda como hash PBKDF2-SHA-256 con sal propia y se compara en tiempo constante; nunca se guarda el PIN.</li>
          <li>No es un servidor de autenticación: quien tenga acceso a este navegador puede abrir sus datos desde las herramientas del navegador o exportar la base. Para datos sensibles, protege el dispositivo.</li>
        </ul>
      </section>

      {editando ? (
        <FormularioPerfil
          existente={editando === 'nuevo' ? null : editando}
          onCerrar={() => setEditando(null)}
        />
      ) : null}
      {cambiandoPin ? <FormularioMiPin tienePin={Boolean(propio?.pin_hash)} onCerrar={() => setCambiandoPin(false)} /> : null}
      {borrando ? (
        <Confirmar titulo="Eliminar perfil" peligro textoBoton="Eliminar perfil" onCerrar={() => setBorrando(null)}
          texto={`Se eliminará el perfil de ${borrando.nombre}. Si ya registró operaciones, no se podrá eliminar y habrá que desactivarlo para conservar la auditoría.`}
          onConfirmar={() => ejecutar(() => eliminarPerfil(ctx, borrando.id), { ok: 'Perfil eliminado.' })} />
      ) : null}
    </>
  );
}

function FormularioPerfil({ existente, onCerrar }: { existente: Perfil | null; onCerrar: () => void }) {
  const { ctx, ejecutar } = useApp();
  const [nombre, setNombre] = useState(existente?.nombre ?? '');
  const [rol, setRol] = useState<Rol>(existente?.rol ?? 'vendedor');
  const [activo, setActivo] = useState(existente?.activo ?? true);
  const [modoPin, setModoPin] = useState<ModoPin>('mantener');
  const [pin, setPin] = useState('');
  const [errorPin, setErrorPin] = useState('');
  const [error, setError] = useState<ErrorDominio | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    let credencial: Credencial | null | undefined;
    const poner = existente ? modoPin === 'nuevo' : pin !== '';
    if (poner) {
      const motivo = validarPin(pin);
      if (motivo) return setErrorPin(motivo);
      setTrabajando(true);
      credencial = await crearCredencial(pin);
    } else if (existente && modoPin === 'quitar') credencial = null;
    const r = ejecutar(() => guardarPerfil(ctx, { id: existente?.id, nombre, rol, activo, credencial }), {
      ok: existente ? 'Perfil actualizado.' : 'Perfil creado.', enLinea: true,
    });
    setTrabajando(false);
    if (!r.ok) return setError(r.error ?? null);
    onCerrar();
  };

  return (
    <Modal titulo={existente ? `Editar perfil: ${existente.nombre}` : 'Nuevo perfil'} onCerrar={onCerrar}>
      <form onSubmit={enviar} noValidate className="form-modal">
        <Campo etiqueta="Nombre">{(p) => <input {...p} data-foco value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} />}</Campo>
        <Campo etiqueta="Rol" ayuda="Define qué secciones y acciones tiene el perfil.">
          {(p) => (
            <select {...p} value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
              {ROLES_VALIDOS.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
            </select>
          )}
        </Campo>
        {existente ? (
          <>
            <Campo etiqueta="PIN">
              {(p) => (
                <select {...p} value={modoPin} onChange={(e) => { setModoPin(e.target.value as ModoPin); setErrorPin(''); }}>
                  <option value="mantener">{existente.tienePin ? 'Mantener el PIN actual' : 'Seguir sin PIN'}</option>
                  <option value="nuevo">{existente.tienePin ? 'Establecer un PIN nuevo' : 'Poner un PIN'}</option>
                  {existente.tienePin ? <option value="quitar">Quitar el PIN</option> : null}
                </select>
              )}
            </Campo>
            <label className="casilla"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Perfil activo (puede entrar)</label>
          </>
        ) : null}
        {(existente ? modoPin === 'nuevo' : true) ? (
          <Campo etiqueta={existente ? 'PIN nuevo' : 'PIN (opcional)'} error={errorPin} ayuda="De 4 a 8 dígitos.">
            {(p) => <input {...p} type="password" inputMode="numeric" autoComplete="new-password" value={pin} maxLength={8} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErrorPin(''); }} />}
          </Campo>
        ) : null}
        <ErrorFormulario error={error} />
        <div className="bienvenida-acciones">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <button type="submit" className="btn btn-primario" disabled={trabajando}>{existente ? 'Guardar cambios' : 'Crear perfil'}</button>
        </div>
      </form>
    </Modal>
  );
}

function FormularioMiPin({ tienePin, onCerrar }: { tienePin: boolean; onCerrar: () => void }) {
  const { ctx, db, ejecutar } = useApp();
  const [actual, setActual] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [repite, setRepite] = useState('');
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  const enviar = async (e: FormEvent, quitar = false) => {
    e.preventDefault();
    setError('');
    setTrabajando(true);
    try {
      if (tienePin) {
        const cred = credencialDe(db, ctx.usuario.id);
        if (!cred || !(await verificarPin(actual, cred))) return setError('El PIN actual no es correcto.');
      }
      if (quitar) {
        ejecutar(() => cambiarMiPin(ctx, null), { ok: 'PIN eliminado.' });
        return onCerrar();
      }
      const motivo = validarPin(nuevo);
      if (motivo) return setError(motivo);
      if (nuevo !== repite) return setError('Los dos PIN nuevos no coinciden.');
      const credencial = await crearCredencial(nuevo);
      ejecutar(() => cambiarMiPin(ctx, credencial), { ok: 'PIN guardado.' });
      onCerrar();
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Modal titulo={tienePin ? 'Cambiar mi PIN' : 'Poner un PIN a mi perfil'} onCerrar={onCerrar}>
      <form onSubmit={(e) => void enviar(e)} noValidate className="form-modal">
        {tienePin ? (
          <Campo etiqueta="PIN actual">{(p) => <input {...p} data-foco type="password" inputMode="numeric" autoComplete="current-password" value={actual} maxLength={8} onChange={(e) => setActual(e.target.value.replace(/\D/g, ''))} />}</Campo>
        ) : null}
        <Campo etiqueta="PIN nuevo" ayuda="De 4 a 8 dígitos.">{(p) => <input {...p} data-foco={!tienePin || undefined} type="password" inputMode="numeric" autoComplete="new-password" value={nuevo} maxLength={8} onChange={(e) => setNuevo(e.target.value.replace(/\D/g, ''))} />}</Campo>
        <Campo etiqueta="Repite el PIN nuevo">{(p) => <input {...p} type="password" inputMode="numeric" autoComplete="new-password" value={repite} maxLength={8} onChange={(e) => setRepite(e.target.value.replace(/\D/g, ''))} />}</Campo>
        {error ? <p className="campo-msg" role="alert">{error}</p> : null}
        <div className="bienvenida-acciones">
          {tienePin ? <button type="button" className="btn btn-peligro" disabled={trabajando} onClick={(e) => void enviar(e, true)}>Quitar PIN</button> : <span />}
          <div>
            <Boton onClick={onCerrar}>Cancelar</Boton>{' '}
            <button type="submit" className="btn btn-primario" disabled={trabajando}>Guardar PIN</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
