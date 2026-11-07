import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as esperar } from 'node:timers/promises';

export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const PUERTO = 4181;
export const URL_BASE = `http://127.0.0.1:${PUERTO}/`;

/** Sirve dist/ con `vite preview` y espera a que responda. */
export async function iniciarServidor() {
  if (!existsSync('dist/index.html')) throw new Error('Falta dist/: ejecuta primero `npm run build`.');
  const proc = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PUERTO), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL_BASE);
      if (r.ok) return () => proc.kill();
    } catch {
      /* aún no responde */
    }
    await esperar(500);
  }
  proc.kill();
  throw new Error('El servidor de vista previa no respondió.');
}

export async function abrirNavegador() {
  if (!existsSync(CHROME)) throw new Error(`No se encontró Chrome en ${CHROME}`);
  return chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] });
}

/** Contexto nuevo (IndexedDB limpio) con vigilancia de errores de consola. */
export async function nuevaPagina(navegador, { ancho = 1440, alto = 900, movil = false } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: alto },
    locale: 'es-CO',
    acceptDownloads: true,
    deviceScaleFactor: movil ? 2 : 1,
    hasTouch: movil,
    isMobile: movil,
  });
  const pagina = await contexto.newPage();
  pagina.setDefaultTimeout(30000);
  const errores = [];
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(`console.error: ${m.text()}`);
  });
  pagina.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  pagina.on('requestfailed', (r) => errores.push(`requestfailed: ${r.url()}`));
  return { contexto, pagina, errores };
}

export async function entrar(pagina, rol = 'administrador') {
  await pagina.goto(URL_BASE);
  await pagina.locator(`[data-usuario="${rol}"]`).first().click({ timeout: 90000 });
  await pagina.locator('.carcasa').waitFor();
}

/** Espera a que la base se haya escrito en IndexedDB. */
export async function esperarGuardado(pagina) {
  await pagina.locator('[data-estado-guardado="guardado"]').waitFor();
}
