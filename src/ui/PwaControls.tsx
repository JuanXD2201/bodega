import { useSyncExternalStore } from 'react';
import { applyUpdate, getPwaState, promptInstall, subscribePwa, type PwaState } from '../pwa';
import { Icono } from './iconos';

export const usePwa = (): PwaState => useSyncExternalStore(subscribePwa, getPwaState, getPwaState);

/** Aviso fijo cuando hay una versión nueva descargada. */
export function UpdateBanner() {
  const { updateReady } = usePwa();
  if (!updateReady) return null;
  return (
    <div className="aviso-version" role="status" data-testid="aviso-actualizacion">
      <span>Hay una versión nueva</span>
      <button type="button" className="btn btn-primario" onClick={applyUpdate}>Recargar</button>
    </div>
  );
}

/** Botón «Instalar aplicación»: solo aparece si el navegador lo permite. */
export function InstallButton({ className = 'lateral-ayuda' }: { className?: string }) {
  const { canInstall } = usePwa();
  if (!canInstall) return null;
  return (
    <button type="button" className={className} onClick={() => void promptInstall()}>
      <Icono n="descargar" tam={16} /> Instalar aplicación
    </button>
  );
}
