import { mkdirSync } from 'node:fs';
import { abrirNavegador, entrar, iniciarServidor, nuevaPagina, URL_BASE } from './ayudas.mjs';

const DIR = 'docs/screenshots';
mkdirSync(DIR, { recursive: true });
const detener = await iniciarServidor();
const navegador = await abrirNavegador();
let total = 0;

async function foto(pagina, errores, nombre) {
  await pagina.waitForTimeout(350);
  await pagina.screenshot({ path: `${DIR}/${nombre}.png` });
  total++;
  console.log(`captura ${nombre}`);
  if (errores.length) throw new Error(`Errores de consola: ${errores.join(' | ')}`);
}

// ---------------------------------------------------------------- escritorio
{
  const { contexto, pagina, errores } = await nuevaPagina(navegador, { ancho: 1440, alto: 900 });
  await pagina.goto(URL_BASE);
  await pagina.getByRole('heading', { name: '¿Con qué usuario quieres entrar?' }).waitFor({ timeout: 90000 });
  await foto(pagina, errores, 'acceso-1440');

  await pagina.locator('[data-usuario="administrador"]').first().click();
  await pagina.locator('.plaqueta').first().waitFor();
  await foto(pagina, errores, 'panel-1440');

  await pagina.goto(URL_BASE + '#/productos');
  await pagina.locator('tbody tr').first().waitFor();
  await foto(pagina, errores, 'productos-1440');

  await pagina.goto(URL_BASE + '#/pedidos/nuevo');
  await pagina.getByLabel('Cliente').selectOption({ label: 'Constructora Horizonte S.A.S.' });
  for (const [sku, cant] of [['HER-1001', '6'], ['FIJ-1009', '12'], ['SEG-1041', '4'], ['ELE-1019', '99999']]) {
    await pagina.getByPlaceholder('Agregar producto por SKU o nombre').fill(sku);
    await pagina.locator('.sugerencias button').first().click();
    await pagina.getByLabel(/^Cantidad de /).last().fill(cant);
  }
  await pagina.getByLabel('Notas').fill('Entrega en obra, torre 2. Llamar antes de descargar.');
  await foto(pagina, errores, 'pedido-edicion-1440');

  await pagina.goto(URL_BASE + '#/existencias');
  await pagina.locator('tbody tr').first().waitFor();
  await pagina.locator('tbody tr').first().getByRole('button', { name: /^Trasladar/ }).click();
  await pagina.getByRole('dialog').getByLabel('Cantidad', { exact: true }).fill('5');
  await foto(pagina, errores, 'existencias-traslado-1440');
  await pagina.keyboard.press('Escape');

  await pagina.goto(URL_BASE + '#/reportes');
  await pagina.getByRole('tab', { name: 'Ventas' }).click();
  await pagina.locator('figure.grafico svg').first().waitFor();
  await foto(pagina, errores, 'reportes-ventas-1440');
  await pagina.getByRole('tab', { name: 'Valor del inventario' }).click();
  await pagina.locator('figure.dona svg').waitFor();
  await foto(pagina, errores, 'reportes-valor-1440');

  await pagina.goto(URL_BASE + '#/consola');
  await pagina.getByRole('button', { name: 'Ejecutar' }).click();
  await pagina.locator('[data-resultado-info]').waitFor();
  await foto(pagina, errores, 'consola-sql-1440');
  await pagina.getByRole('tab', { name: 'Esquema' }).click();
  await pagina.getByRole('heading', { name: /Triggers/ }).waitFor();
  await foto(pagina, errores, 'esquema-1440');

  await pagina.goto(URL_BASE + '#/auditoria');
  await pagina.locator('tbody tr').first().waitFor();
  await foto(pagina, errores, 'auditoria-1440');
  await contexto.close();
}

// -------------------------------------------------------------------- móvil
{
  const { contexto, pagina, errores } = await nuevaPagina(navegador, { ancho: 390, alto: 844, movil: true });
  await entrar(pagina, 'administrador');
  await pagina.locator('.plaqueta').first().waitFor();
  await foto(pagina, errores, 'panel-390');
  await pagina.goto(URL_BASE + '#/productos');
  await pagina.locator('tbody tr').first().waitFor();
  await foto(pagina, errores, 'productos-390');
  await pagina.goto(URL_BASE + '#/pedidos/nuevo');
  await pagina.getByLabel('Cliente').selectOption({ label: 'Almacén La Doce' });
  await pagina.getByPlaceholder('Agregar producto por SKU o nombre').fill('PIN-1033');
  await pagina.locator('.sugerencias button').first().click();
  await pagina.getByLabel(/^Cantidad de /).fill('8');
  await pagina.locator('.tabla-lineas').scrollIntoViewIfNeeded();
  await pagina.evaluate(() => window.scrollBy(0, 120));
  await foto(pagina, errores, 'pedido-390');
  await contexto.close();
}

await navegador.close();
detener();
console.log(`${total} capturas generadas en ${DIR}`);
