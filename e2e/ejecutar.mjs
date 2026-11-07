import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { abrirNavegador, entrar, esperarGuardado, iniciarServidor, nuevaPagina, URL_BASE } from './ayudas.mjs';

const pruebas = [];
const prueba = (nombre, fn, opciones) => pruebas.push({ nombre, fn, opciones });
const texto = (p, t) => p.getByText(t, { exact: false }).first();

// ------------------------------------------------------------------ acceso
prueba('acceso: muestra el aviso de demostración y los cinco usuarios', async ({ pagina }) => {
  await pagina.goto(URL_BASE);
  await pagina.getByRole('heading', { name: '¿Con qué usuario quieres entrar?' }).waitFor({ timeout: 90000 });
  assert.match(await pagina.locator('.acceso-demo').innerText(), /Demostración/);
  assert.equal(await pagina.locator('.acceso-usuario').count(), 5);
});

prueba('administrador: el panel muestra indicadores reales calculados en SQL', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.getByRole('heading', { name: 'Panel', level: 1 }).waitFor();
  assert.equal(await pagina.locator('.plaqueta').count(), 5);
  assert.match(await pagina.locator('.plaquetas').innerText(), /Valor del inventario/);
  assert.ok((await pagina.locator('figure.grafico svg').count()) >= 1);
  assert.match(await pagina.locator('.plaqueta-valor').first().innerText(), /\d/);
});

// ------------------------------------------------------------------ productos
prueba('productos: crea un producto, valida precio menor al costo y persiste tras recargar', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/productos');
  await pagina.getByRole('button', { name: 'Nuevo producto' }).click();
  await pagina.getByLabel('SKU', { exact: true }).fill('tst-9001');
  await pagina.getByLabel('Nombre', { exact: true }).fill('Producto de prueba e2e');
  await pagina.getByLabel('Costo (COP)').fill('5000');
  await pagina.getByLabel('Precio de venta (COP)').fill('4000');
  await pagina.getByRole('button', { name: 'Guardar producto' }).click();
  await texto(pagina, 'El precio de venta no puede ser menor al costo').waitFor();
  await pagina.getByLabel('Precio de venta (COP)').fill('7500');
  await pagina.getByRole('button', { name: 'Guardar producto' }).click();
  await texto(pagina, 'Producto creado.').waitFor();
  await esperarGuardado(pagina);
  await pagina.reload();
  await pagina.locator('.carcasa').waitFor({ timeout: 60000 });
  await pagina.goto(URL_BASE + '#/productos');
  await pagina.getByPlaceholder('Buscar por SKU o nombre').fill('TST-9001');
  await pagina.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  await pagina.locator('tbody tr').filter({ hasText: 'TST-9001' }).waitFor();
});

prueba('productos: filtra por búsqueda y por stock bajo', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/productos');
  await pagina.locator('tbody tr').first().waitFor();
  const total = await pagina.locator('tbody tr').count();
  assert.ok(total >= 60);
  await pagina.getByPlaceholder('Buscar por SKU o nombre').fill('martillo');
  await pagina.waitForFunction((t) => document.querySelectorAll('tbody tr').length < t, total);
  assert.ok((await pagina.locator('tbody tr').count()) < 5);
  await pagina.getByPlaceholder('Buscar por SKU o nombre').fill('');
  await pagina.getByLabel('Estado').selectOption('bajo');
  await pagina.waitForFunction((t) => { const n = document.querySelectorAll('tbody tr').length; return n >= 4 && n < t; }, total);
});

prueba('productos: la importación CSV malformada se rechaza y la válida se aplica', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/productos');
  await pagina.getByRole('button', { name: 'Importar CSV' }).click();
  const area = pagina.getByLabel('…o pega el contenido');
  const importar = () => pagina.getByRole('dialog').getByRole('button', { name: 'Importar', exact: true }).click();
  await area.fill('sku,nombre,categoria,costo,precio\nCSV-001,"Comilla sin cerrar,Cat,1,2');
  await importar();
  await texto(pagina, 'Comilla sin cerrar').waitFor();
  await area.fill('sku,nombre,categoria,costo,precio\nCSV-001,Importado uno,Herramientas manuales,1000,1800\nCSV-002,Importado dos,Herramientas manuales,2000,1000');
  await importar();
  await texto(pagina, 'No se importó nada').waitFor();
  await texto(pagina, 'Fila 3').waitFor();
  await area.fill('sku,nombre,categoria,costo,precio\nCSV-001,Importado uno,Herramientas manuales,1000,1800');
  await importar();
  await texto(pagina, 'Importación lista: 1 productos nuevos').waitFor();
});

prueba('productos: exporta CSV con encabezado', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/productos');
  const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('button', { name: 'Exportar CSV' }).click()]);
  assert.equal(descarga.suggestedFilename(), 'productos.csv');
  const contenido = readFileSync(await descarga.path(), 'utf8');
  assert.match(contenido, /sku,nombre,categoria,proveedor,unidad,costo,precio,stock_minimo,activo/);
  assert.ok(contenido.split('\n').length > 60);
});

// ------------------------------------------------------------------ pedidos
async function crearPedido(pagina, { cliente = 'Ferretería El Tornillo Feliz', busca = 'HER-1001', cantidad = '3' } = {}) {
  await pagina.goto(URL_BASE + '#/pedidos/nuevo');
  await pagina.getByLabel('Cliente').selectOption({ label: cliente });
  await pagina.getByPlaceholder('Agregar producto por SKU o nombre').fill(busca);
  await pagina.locator('.sugerencias button').first().click();
  await pagina.getByLabel(/^Cantidad de /).fill(cantidad);
}
const stockTotal = async (pagina, sku) => {
  await pagina.goto(URL_BASE + '#/existencias');
  const fila = pagina.locator('tbody tr').filter({ hasText: sku });
  await fila.waitFor();
  return Number((await fila.locator('td[data-label="Total"]').innerText()).replace(/\D/g, ''));
};

prueba('vendedor: crea un pedido, lo confirma y el stock baja', async ({ pagina }) => {
  await entrar(pagina, 'vendedor');
  const antes = await stockTotal(pagina, 'HER-1001');
  await crearPedido(pagina);
  await pagina.getByRole('button', { name: 'Confirmar pedido' }).click();
  await pagina.locator('.insignia', { hasText: 'Confirmado' }).waitFor();
  const despues = await stockTotal(pagina, 'HER-1001');
  assert.equal(antes - despues, 3);
});

prueba('vendedor: no puede confirmar con stock insuficiente y el pedido sigue en borrador', async ({ pagina }) => {
  await entrar(pagina, 'vendedor');
  await crearPedido(pagina, { cantidad: '99999' });
  await texto(pagina, 'superan el stock').or(texto(pagina, 'supera el stock')).first().waitFor();
  await pagina.getByRole('button', { name: 'Confirmar pedido' }).click();
  await texto(pagina, 'No hay stock suficiente para confirmar el pedido').waitFor();
  await pagina.goto(URL_BASE + '#/pedidos');
  await pagina.getByLabel('Estado').selectOption('borrador');
  await pagina.locator('tbody tr').first().waitFor();
});

prueba('vendedor: anular un pedido confirmado y deshacer restaura el estado', async ({ pagina }) => {
  await entrar(pagina, 'vendedor');
  await crearPedido(pagina);
  await pagina.getByRole('button', { name: 'Confirmar pedido' }).click();
  await pagina.locator('.insignia', { hasText: 'Confirmado' }).waitFor();
  await pagina.getByRole('button', { name: 'Anular pedido' }).click();
  await pagina.getByRole('dialog').getByRole('button', { name: 'Anular pedido' }).click();
  await pagina.locator('.insignia', { hasText: 'Anulado' }).waitFor();
  await pagina.getByRole('button', { name: 'Deshacer' }).last().click();
  await pagina.locator('.insignia', { hasText: 'Confirmado' }).waitFor();
});

prueba('permisos: el vendedor no ve Compras ni Auditoría y la URL directa lo bloquea', async ({ pagina }) => {
  await entrar(pagina, 'vendedor');
  const menu = await pagina.locator('.lateral nav').innerText();
  assert.ok(!/Compras|Auditoría|Proveedores/.test(menu), menu);
  await pagina.goto(URL_BASE + '#/compras');
  await pagina.getByRole('heading', { name: 'Sin acceso a esta sección' }).waitFor();
  await pagina.goto(URL_BASE + '#/auditoria');
  await pagina.getByRole('heading', { name: 'Sin acceso a esta sección' }).waitFor();
});

prueba('bodeguero: despacha un pedido confirmado por otro usuario', async ({ pagina }) => {
  await entrar(pagina, 'vendedor');
  await crearPedido(pagina);
  await pagina.getByRole('button', { name: 'Confirmar pedido' }).click();
  await pagina.locator('.insignia', { hasText: 'Confirmado' }).waitFor();
  const url = pagina.url();
  await esperarGuardado(pagina);
  await pagina.getByRole('button', { name: 'Cambiar de usuario' }).click();
  await pagina.locator('[data-usuario="bodeguero"]').first().click();
  await pagina.goto(url);
  await pagina.getByRole('button', { name: 'Marcar como despachado' }).waitFor();
  assert.equal(await pagina.getByRole('button', { name: 'Anular pedido' }).count(), 0);
  await pagina.getByRole('button', { name: 'Marcar como despachado' }).click();
  await pagina.getByRole('dialog').getByRole('button', { name: 'Despachar' }).click();
  await pagina.locator('.insignia', { hasText: 'Despachado' }).waitFor();
});

// -------------------------------------------------------------- existencias
prueba('bodeguero: traslada stock entre bodegas y queda en auditoría', async ({ pagina }) => {
  await entrar(pagina, 'bodeguero');
  await pagina.goto(URL_BASE + '#/existencias');
  const fila = pagina.locator('tbody tr').filter({ hasText: 'HER-1002' });
  await fila.getByRole('button', { name: 'Trasladar HER-1002' }).click();
  await pagina.getByRole('dialog').getByLabel('Cantidad', { exact: true }).fill('4');
  await pagina.getByRole('dialog').getByRole('button', { name: 'Trasladar' }).click();
  await texto(pagina, 'Traslado de HER-1002 registrado').waitFor();
  await pagina.goto(URL_BASE + '#/auditoria');
  await pagina.getByPlaceholder(/Buscar por SKU/).fill('HER-1002');
  await pagina.locator('tbody tr').filter({ hasText: 'Traslado · salida' }).first().waitFor();
});

prueba('bodeguero: un ajuste que deja stock negativo se rechaza con mensaje claro', async ({ pagina }) => {
  await entrar(pagina, 'bodeguero');
  await pagina.goto(URL_BASE + '#/existencias');
  await pagina.locator('tbody tr').filter({ hasText: 'HER-1003' }).getByRole('button', { name: 'Ajustar HER-1003' }).click();
  await pagina.getByLabel('Cantidad a sumar o restar').fill('-99999');
  await pagina.getByRole('dialog').getByRole('button', { name: 'Registrar ajuste' }).click();
  await pagina.getByRole('dialog').getByRole('alert').filter({ hasText: 'Stock insuficiente' }).waitFor();
});

// ------------------------------------------------------------------- compras
prueba('bodeguero: registra una recepción parcial de una orden enviada', async ({ pagina }) => {
  await entrar(pagina, 'bodeguero');
  await pagina.goto(URL_BASE + '#/compras');
  await pagina.getByLabel('Estado').selectOption('enviada');
  const enlace = pagina.locator('tbody tr').first().getByRole('link').first();
  await enlace.waitFor();
  await enlace.click();
  await pagina.getByRole('button', { name: 'Registrar recepción' }).click();
  await pagina.getByLabel(/^Cantidad recibida de /).first().fill('1');
  await pagina.getByRole('dialog').getByRole('button', { name: /^Recibir/ }).click();
  await texto(pagina, 'Recepción registrada').waitFor();
  await pagina.locator('.insignia', { hasText: 'Parcial' }).waitFor();
});

prueba('administrador: crea una orden de compra y la envía', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/compras/nuevo');
  await pagina.getByLabel('Proveedor').selectOption({ index: 1 });
  await pagina.getByPlaceholder('Agregar producto por SKU o nombre').fill('FIJ-');
  await pagina.locator('.sugerencias button').first().click();
  await pagina.getByRole('button', { name: 'Guardar y enviar' }).click();
  await pagina.locator('.insignia', { hasText: 'Enviada' }).waitFor();
});

// ------------------------------------------------------------------ terceros
prueba('clientes: crea un cliente con validación de correo', async ({ pagina }) => {
  await entrar(pagina, 'vendedor');
  await pagina.goto(URL_BASE + '#/clientes');
  await pagina.getByRole('button', { name: 'Nuevo cliente' }).click();
  await pagina.getByLabel('Nombre o razón social').fill('Cliente e2e S.A.S.');
  await pagina.getByLabel('Documento', { exact: true }).fill('999.888.777-1');
  await pagina.getByLabel('Correo electrónico').fill('correo-invalido');
  await pagina.getByRole('button', { name: 'Guardar', exact: true }).click();
  await pagina.getByRole('dialog').getByRole('alert').filter({ hasText: 'correo' }).waitFor();
  await pagina.getByLabel('Correo electrónico').fill('contacto@e2e.co');
  await pagina.getByRole('button', { name: 'Guardar', exact: true }).click();
  await texto(pagina, 'Cliente creado').waitFor();
});

prueba('proveedores: solo lectura para el bodeguero', async ({ pagina }) => {
  await entrar(pagina, 'bodeguero');
  await pagina.goto(URL_BASE + '#/proveedores');
  await pagina.locator('tbody tr').first().waitFor();
  assert.equal(await pagina.getByRole('button', { name: 'Nuevo proveedor' }).count(), 0);
});

// ------------------------------------------------------------------ reportes
prueba('reportes: gráficos SVG en cada pestaña', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/reportes');
  await pagina.locator('tbody tr').first().waitFor();
  await pagina.getByRole('tab', { name: 'Rotación' }).click();
  await pagina.locator('.hbarras li').first().waitFor();
  await pagina.getByRole('tab', { name: 'Ventas' }).click();
  await pagina.locator('figure.grafico svg[role="img"]').first().waitFor();
  await pagina.getByRole('tab', { name: 'Valor del inventario' }).click();
  await pagina.locator('figure.dona svg[role="img"]').waitFor();
});

// ------------------------------------------------------------------- consola
prueba('consola SQL: ejecuta SELECT y rechaza escrituras', async ({ pagina }) => {
  await entrar(pagina, 'vendedor');
  await pagina.goto(URL_BASE + '#/consola');
  await pagina.getByRole('button', { name: 'Ejecutar' }).click();
  await pagina.locator('[data-resultado-info]').waitFor();
  assert.ok((await pagina.locator('.tabla-sql tbody tr').count()) >= 4);
  await pagina.locator('#sql-area').fill('DELETE FROM productos');
  await pagina.keyboard.press('Control+Enter');
  await pagina.getByRole('alert').filter({ hasText: 'solo lectura' }).first().waitFor();
  await pagina.locator('#sql-area').fill('SELECT COUNT(*) AS n FROM productos');
  await pagina.keyboard.press('Control+Enter');
  await pagina.locator('.tabla-sql tbody td').filter({ hasText: /^6\d$/ }).first().waitFor();
});

prueba('consola SQL: esquema y descarga de scripts MySQL, SQL Server y .sqlite', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/consola');
  await pagina.getByRole('tab', { name: 'Esquema' }).click();
  await pagina.getByRole('heading', { name: /Triggers/ }).waitFor();
  await pagina.getByRole('tab', { name: 'Base de datos y scripts' }).click();
  const [mysql] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('listitem').filter({ hasText: 'schema.mysql.sql' }).getByRole('button').click()]);
  assert.equal(mysql.suggestedFilename(), 'schema.mysql.sql');
  const m = readFileSync(await mysql.path(), 'utf8');
  assert.match(m, /CREATE TABLE productos/);
  assert.match(m, /INSERT INTO productos/);
  assert.match(m, /SIGNAL SQLSTATE/);
  const [mssql] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('listitem').filter({ hasText: 'schema.mssql.sql' }).getByRole('button').click()]);
  assert.equal(mssql.suggestedFilename(), 'schema.mssql.sql');
  assert.match(readFileSync(await mssql.path(), 'utf8'), /SET IDENTITY_INSERT productos ON/);
  const [bd] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('button', { name: 'Exportar .sqlite' }).click()]);
  assert.equal(readFileSync(await bd.path()).subarray(0, 15).toString('latin1'), 'SQLite format 3');
});

prueba('consola SQL: el vendedor no puede exportar ni restablecer la base', async ({ pagina }) => {
  await entrar(pagina, 'vendedor');
  await pagina.goto(URL_BASE + '#/consola');
  await pagina.getByRole('tab', { name: 'Base de datos y scripts' }).click();
  assert.equal(await pagina.getByRole('button', { name: 'Exportar .sqlite' }).isDisabled(), true);
  assert.equal(await pagina.getByRole('button', { name: /Restablecer/ }).isDisabled(), true);
});

prueba('administrador: restablecer la demostración descarta los cambios', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/clientes');
  await pagina.getByRole('button', { name: 'Nuevo cliente' }).click();
  await pagina.getByLabel('Nombre o razón social').fill('Cliente temporal');
  await pagina.getByLabel('Documento', { exact: true }).fill('111222333');
  await pagina.getByRole('button', { name: 'Guardar', exact: true }).click();
  await texto(pagina, 'Cliente creado').waitFor();
  await pagina.goto(URL_BASE + '#/consola');
  await pagina.getByRole('tab', { name: 'Base de datos y scripts' }).click();
  await pagina.getByRole('button', { name: /Restablecer datos/ }).click();
  await pagina.getByRole('dialog').getByRole('button', { name: 'Restablecer' }).click();
  await texto(pagina, 'Datos de demostración restablecidos').waitFor();
  await pagina.goto(URL_BASE + '#/clientes');
  await pagina.getByPlaceholder(/Buscar por nombre/).fill('temporal');
  await pagina.getByText('Sin clientes').waitFor();
});

// ------------------------------------------------------------ teclado y a11y
prueba('teclado: g + letra navega, / enfoca la búsqueda, ? abre la ayuda y Esc la cierra', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.keyboard.press('g');
  await pagina.keyboard.press('p');
  await pagina.getByRole('heading', { name: 'Productos', level: 1 }).waitFor();
  await pagina.keyboard.press('/');
  assert.equal(await pagina.evaluate(() => document.activeElement?.getAttribute('type')), 'search');
  await pagina.locator('main').click({ position: { x: 5, y: 5 } });
  await pagina.keyboard.press('?');
  await pagina.getByRole('dialog', { name: 'Atajos de teclado' }).waitFor();
  await pagina.keyboard.press('Escape');
  await pagina.getByRole('dialog').waitFor({ state: 'detached' });
});

prueba('accesibilidad: landmarks y foco atrapado en el modal', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/productos');
  assert.equal(await pagina.locator('main').count(), 1);
  assert.ok((await pagina.locator('nav[aria-label]').count()) >= 1);
  await pagina.getByRole('button', { name: 'Nuevo producto' }).click();
  const dialogo = pagina.getByRole('dialog');
  await dialogo.waitFor();
  for (let i = 0; i < 25; i++) await pagina.keyboard.press('Tab');
  assert.equal(await pagina.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true);
  await pagina.keyboard.press('Escape');
  await dialogo.waitFor({ state: 'detached' });
});

prueba('auditoría: pagina y filtra el libro de movimientos', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/auditoria');
  await pagina.locator('tbody tr').first().waitFor();
  assert.equal(await pagina.locator('tbody tr').count(), 40);
  await pagina.getByRole('button', { name: 'Siguiente' }).click();
  await texto(pagina, 'página 2 de').waitFor();
  await pagina.getByLabel('Tipo').selectOption('ajuste');
  await texto(pagina, 'página 1 de').waitFor();
  assert.ok((await pagina.locator('tbody tr').count()) <= 40);
});

// ------------------------------------------------------------------- móvil
prueba('móvil 390x844: navegación inferior, tarjetas y sin desborde horizontal', async ({ pagina }) => {
  await entrar(pagina, 'administrador');
  await pagina.goto(URL_BASE + '#/productos');
  await pagina.locator('tbody tr').first().waitFor();
  assert.equal(await pagina.locator('.nav-movil').isVisible(), true);
  assert.equal(await pagina.locator('.lateral').isVisible(), false);
  const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(desborde <= 1, `desborde horizontal de ${desborde}px`);
  await pagina.getByRole('button', { name: 'Más' }).click();
  await pagina.getByRole('dialog').getByRole('link', { name: 'Consola SQL' }).click();
  await pagina.getByRole('heading', { name: 'Consola SQL', level: 1 }).waitFor();
}, { movil: true, ancho: 390, alto: 844 });

// ================================================================ ejecución
mkdirSync('e2e/.tmp', { recursive: true });
const filtro = process.argv[2];
const detener = await iniciarServidor();
const navegador = await abrirNavegador();
let ok = 0;
const fallos = [];
const seleccion = pruebas.filter((p) => !filtro || p.nombre.includes(filtro));
for (const p of seleccion) {
  const inicio = Date.now();
  const sesion = await nuevaPagina(navegador, p.opciones);
  try {
    await p.fn(sesion);
    await sesion.pagina.waitForTimeout(150);
    assert.deepEqual(sesion.errores, [], 'Errores de consola durante la prueba');
    ok++;
    console.log(`  ok    ${p.nombre} (${Math.round((Date.now() - inicio) / 100) / 10} s)`);
  } catch (e) {
    fallos.push(p.nombre);
    console.log(`  FALLA ${p.nombre}\n         ${String(e.message).split('\n').slice(0, 6).join('\n         ')}`);
    await sesion.pagina.screenshot({ path: `e2e/.tmp/falla-${fallos.length}.png` }).catch(() => undefined);
  } finally {
    await sesion.contexto.close();
  }
}
await navegador.close();
detener();
console.log(`\nE2E: ${ok} de ${seleccion.length} pruebas superadas${fallos.length ? `, ${fallos.length} con fallas` : ''}.`);
process.exit(fallos.length ? 1 : 0);
