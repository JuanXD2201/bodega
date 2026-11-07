/** Registro del service worker, aviso de actualización e instalación como aplicación. */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** Hay una versión nueva descargada esperando a que el usuario recargue. */
  updateReady: boolean;
  /** El navegador permite mostrar el botón «Instalar aplicación». */
  canInstall: boolean;
  /** La app ya corre como aplicación instalada. */
  installed: boolean;
  /** Todo el contenido está en caché: funciona sin conexión. */
  offlineReady: boolean;
}

const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

let state: PwaState = { updateReady: false, canInstall: false, installed: isStandalone(), offlineReady: false };
const listeners = new Set<() => void>();
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
let reloadRequested = false;
let registration: ServiceWorkerRegistration | null = null;

const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const getPwaState = (): PwaState => state;
export function subscribePwa(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    set({ canInstall: false, installed: true });
  });
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  navigator.storage?.persist?.().catch(() => undefined);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const track = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state !== 'installed') return;
          if (navigator.serviceWorker.controller) {
            waiting = worker;
            set({ updateReady: true });
          } else {
            set({ offlineReady: true });
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting;
        set({ updateReady: true });
      }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      registration = reg;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
      });
    })
    .catch(() => undefined);
  navigator.serviceWorker.ready.then(() => set({ offlineReady: true })).catch(() => undefined);
}

/** Activa la versión nueva y recarga la página. */
export function applyUpdate(): void {
  reloadRequested = true;
  if (waiting) waiting.postMessage('SKIP_WAITING');
  else window.location.reload();
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const event = deferredPrompt;
  deferredPrompt = null;
  set({ canInstall: false });
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}

/** Pide al navegador que busque una versión nueva del service worker. */
export async function checkForUpdate(): Promise<void> {
  await registration?.update();
}
