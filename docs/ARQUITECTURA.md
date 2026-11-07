# Arquitectura

Bodega es un sitio estático. No hay servidor: la base de datos es un archivo SQLite que se ejecuta en el navegador y se guarda en IndexedDB.

```
┌────────────────────────── navegador ───────────────────────────┐
│  UI (React 19)                                                 │
│   páginas · componentes · gráficos SVG                         │
│        │ useApp().ejecutar(...) / useConsulta(...)             │
│  Dominio (TypeScript puro, sin DOM)                            │
│   servicios por caso de uso · permisos · validaciones          │
│        │ SQL parametrizado                                     │
│  Datos                                                         │
│   Db (envoltura de sql.js) · migraciones · almacén IndexedDB   │
│        │                                                       │
│  SQLite en WebAssembly  ──►  triggers · vistas · restricciones │
└────────────────────────────────────────────────────────────────┘
```

## Capas

**Datos (`src/data`).** `Db` envuelve sql.js: `run`, `all`, `get` siempre con parámetros enlazados, transacciones anidables mediante puntos de guardado, modo de solo lectura (`PRAGMA query_only`) y reemplazo del archivo completo (usado por *deshacer*, importar y restablecer). `migraciones.ts` aplica el esquema por versión. `almacen.ts` serializa la base en IndexedDB.

**Dominio (`src/domain`).** Un módulo por área (`catalogo`, `terceros`, `inventario`, `pedidos`, `compras`, `reportes`, `consola`, `exportar`). Cada función recibe un `Contexto` (`db`, usuario, reloj inyectable) y:

1. exige el permiso (`exigir`), de modo que las reglas de rol no dependen de qué botones se muestren;
2. valida entradas y produce mensajes comprensibles;
3. ejecuta la operación en una transacción (`operar`);
4. traduce los errores del motor a `ErrorDominio` con código (`validacion`, `permiso`, `estado`, `stock`, …).

Además de los permisos por rol hay una regla de propiedad: un vendedor solo modifica los pedidos que creó.

**Base de datos como última línea de defensa.** Las reglas críticas (stock no negativo, transiciones de estado, precio ≥ costo, inmutabilidad del libro) están también en triggers y restricciones. El dominio las comprueba antes para dar mensajes claros; si algo se saltara el dominio, la base lo rechazaría igual.

**UI (`src/ui`).** `estado.tsx` abre o crea la base, mantiene el usuario de la sesión y ofrece `ejecutar`, que corre una acción del dominio, refresca las consultas, persiste en IndexedDB y muestra avisos. Con `deshacer: true` toma una instantánea de la base antes de la acción y la restaura si el usuario pulsa *Deshacer*. La navegación usa el hash de la URL, así que funciona en cualquier alojamiento estático.

## Decisiones

- **SQLite en WASM, no un arreglo en memoria.** El valor del proyecto es el modelo relacional real; por eso hay consola SQL y scripts para MySQL y SQL Server.
- **Movimientos como única fuente de cambios de stock.** Ningún código escribe en `existencias`; los triggers aplican los movimientos. Esto hace trivial la auditoría y permite verificar que todo cuadra.
- **Semilla a través del dominio.** El historial de 120 días se genera con los mismos servicios que usa la interfaz, con un reloj simulado y un generador pseudoaleatorio con semilla fija. Resultado: datos reproducibles y movimientos coherentes con los triggers.
- **Persistir toda la base tras cada operación.** Son unos 380 KB; el costo es despreciable y evita estados intermedios.
- **Deshacer por instantánea.** Es simple y correcto para cualquier operación, aunque solo cubre la última acción y la sesión actual.
- **Sin dependencias de UI ni de gráficos.** Los gráficos son SVG propios con tabla de datos alternativa para lectores de pantalla.
- **Fuentes autoalojadas** (Barlow Condensed, Barlow, IBM Plex Mono) mediante paquetes npm; el sitio no hace peticiones a terceros.

## Pruebas

- `src/test/*.test.ts` (Vitest, entorno Node): usan la base real en memoria, sin DOM. Cubren cada trigger y restricción, reglas de estado, permisos por rol, vistas con cifras verificadas a mano, CSV malformado, SQL parametrizado ante entradas hostiles, la consola de solo lectura, la semilla y los scripts exportados.
- `e2e/` (Playwright con `playwright-core` y el Chrome instalado): sirve `dist/` con `vite preview`, recorre flujos reales por rol y falla si hay errores de consola. `e2e/capturas.mjs` genera las imágenes de `docs/screenshots/`.

## Límites conocidos

- Un solo usuario a la vez por navegador: no hay sincronización ni concurrencia entre pestañas.
- Los datos viven en el navegador; borrar los datos del sitio los elimina (de ahí la exportación `.sqlite`).
- No hay autenticación real: el selector de usuario es una demostración de roles.
