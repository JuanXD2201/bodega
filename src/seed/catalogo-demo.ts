/** Datos maestros de la demostración: una distribuidora de suministros industriales y de ferretería. */

export const ROLES = [
  { id: 1, nombre: 'administrador', descripcion: 'Acceso completo: catálogo, compras, terceros, auditoría y administración de la base.' },
  { id: 2, nombre: 'vendedor', descripcion: 'Crea y confirma pedidos propios, gestiona clientes y consulta catálogo y existencias.' },
  { id: 3, nombre: 'bodeguero', descripcion: 'Despacha pedidos, ajusta y traslada existencias y recibe compras.' },
] as const;

export const USUARIOS = [
  { id: 1, nombre: 'Marcela Rojas', email: 'marcela.rojas@bodega.demo', rol_id: 1 },
  { id: 2, nombre: 'Andrés Peña', email: 'andres.pena@bodega.demo', rol_id: 2 },
  { id: 3, nombre: 'Laura Cruz', email: 'laura.cruz@bodega.demo', rol_id: 2 },
  { id: 4, nombre: 'Diego Salazar', email: 'diego.salazar@bodega.demo', rol_id: 3 },
  { id: 5, nombre: 'Camila Ortiz', email: 'camila.ortiz@bodega.demo', rol_id: 3 },
] as const;

export const BODEGAS = [
  { id: 1, codigo: 'BOG', nombre: 'Bodega Central Bogotá', ciudad: 'Bogotá' },
  { id: 2, codigo: 'MED', nombre: 'Bodega Medellín', ciudad: 'Medellín' },
  { id: 3, codigo: 'CAL', nombre: 'Bodega Cali', ciudad: 'Cali' },
] as const;

export const CATEGORIAS = [
  { prefijo: 'HER', nombre: 'Herramientas manuales', descripcion: 'Herramienta de mano para obra y taller.' },
  { prefijo: 'FIJ', nombre: 'Fijaciones y tornillería', descripcion: 'Tornillos, pernos, chazos y remaches.' },
  { prefijo: 'ELE', nombre: 'Material eléctrico', descripcion: 'Cable, tomas, interruptores y protecciones.' },
  { prefijo: 'PLO', nombre: 'Plomería', descripcion: 'Tubería, accesorios y selladores.' },
  { prefijo: 'PIN', nombre: 'Pintura y acabados', descripcion: 'Pinturas, solventes y accesorios de aplicación.' },
  { prefijo: 'SEG', nombre: 'Seguridad industrial', descripcion: 'Protección personal y trabajo en alturas.' },
  { prefijo: 'ASE', nombre: 'Aseo y limpieza', descripcion: 'Productos de limpieza institucional.' },
  { prefijo: 'EMP', nombre: 'Empaque y embalaje', descripcion: 'Cajas, cintas, películas y estibas.' },
] as const;

export const PROVEEDORES = [
  ['Herramientas Andinas S.A.S.', '900.412.118-3', 'Julián Mora', 'Bogotá'],
  ['Tornillos y Fijaciones del Valle', '800.221.907-1', 'Paola Giraldo', 'Cali'],
  ['Eléctricos Sabana Ltda.', '830.115.664-9', 'Ricardo Herrera', 'Bogotá'],
  ['Distribuciones Hidráulicas del Norte', '890.904.311-5', 'Sandra Builes', 'Medellín'],
  ['Pinturas Cordillera S.A.', '860.007.322-0', 'Mauricio Lozano', 'Bogotá'],
  ['Protección Industrial Total', '901.003.845-6', 'Natalia Quintero', 'Medellín'],
  ['Químicos y Aseo Pacífico', '805.019.272-8', 'Hernán Cortés', 'Cali'],
  ['Empaques y Estibas Andes', '900.775.019-2', 'Lucía Barrera', 'Bogotá'],
  ['Importadora Ferretera del Caribe', '802.016.554-4', 'Óscar Meza', 'Barranquilla'],
  ['Cables y Conductores Antioquia', '811.036.700-7', 'Beatriz Arango', 'Medellín'],
  ['Suministros Industriales Centro', '830.058.912-1', 'Felipe Rincón', 'Bogotá'],
  ['Aceros y Metales del Pacífico', '890.311.476-2', 'Diana Valencia', 'Cali'],
] as const;

export const CLIENTES = [
  ['Ferretería El Tornillo Feliz', '900.118.203-5', 'Bogotá'],
  ['Constructora Horizonte S.A.S.', '901.227.554-1', 'Bogotá'],
  ['Ferrosur Distribuciones', '800.543.109-6', 'Cali'],
  ['Obras Civiles del Eje Ltda.', '810.002.738-0', 'Manizales'],
  ['Almacén La Doce', '890.332.981-4', 'Medellín'],
  ['Mantenimientos Industriales MJ', '900.664.320-8', 'Medellín'],
  ['Hotel Parque Central', '860.512.044-3', 'Bogotá'],
  ['Colegio San Ignacio de Loyola', '860.014.790-2', 'Bogotá'],
  ['Clínica Santa Teresa', '890.907.215-9', 'Medellín'],
  ['Talleres Metálicos Rivera', '900.870.116-7', 'Cali'],
  ['Ferretería Don Chucho', '79.455.201-2', 'Soacha'],
  ['Urbanizaciones Altamira', '901.356.442-0', 'Cali'],
  ['Centro Comercial Plaza Real', '830.122.677-5', 'Bogotá'],
  ['Cooperativa Agrícola del Cauca', '891.300.482-1', 'Popayán'],
  ['Instalaciones Eléctricas Pérez', '71.690.338-4', 'Envigado'],
  ['Acabados y Diseño Interior SAS', '900.931.005-9', 'Bogotá'],
  ['Bodegas Logísticas del Sur', '901.045.763-2', 'Cali'],
  ['Alcaldía Municipal de Chía', '899.999.172-0', 'Chía'],
  ['Pinturas y Más La Esquina', '1.020.443.118-6', 'Bogotá'],
  ['Hospital Regional del Norte', '800.215.340-7', 'Medellín'],
] as const;

/** [nombre, unidad, costo en COP] por categoría; el SKU se arma con el prefijo y el orden. */
export const PRODUCTOS_POR_CATEGORIA: Record<string, readonly (readonly [string, string, number])[]> = {
  HER: [
    ['Martillo de uña 16 oz', 'und', 18500], ['Destornillador plano 6 mm', 'und', 6200], ['Destornillador estrella PH2', 'und', 6200],
    ['Alicate universal 8"', 'und', 19800], ['Llave ajustable 10"', 'und', 24500], ['Flexómetro 5 m', 'und', 9800],
    ['Nivel de burbuja 24"', 'und', 17500], ['Serrucho 20"', 'und', 15900],
  ],
  FIJ: [
    ['Tornillo drywall 6x1" caja x100', 'caja', 4800], ['Tornillo autoperforante 8x1" caja x100', 'caja', 7200],
    ['Perno hexagonal 3/8"x2"', 'und', 650], ['Tuerca hexagonal 3/8" bolsa x50', 'bolsa', 5400],
    ['Arandela plana 3/8" bolsa x100', 'bolsa', 4100], ['Chazo plástico 1/4" bolsa x100', 'bolsa', 3900],
    ['Puntilla 2" por kilo', 'kg', 6800], ['Remache pop 1/8" caja x100', 'caja', 5600],
  ],
  ELE: [
    ['Cable THHN 12 AWG rollo 100 m', 'rollo', 148000], ['Cable THHN 14 AWG rollo 100 m', 'rollo', 98000],
    ['Tomacorriente doble blanco', 'und', 5900], ['Interruptor sencillo blanco', 'und', 3800],
    ['Bombillo LED 9 W luz blanca', 'und', 3200], ['Cinta aislante negra 18 mm', 'und', 2100],
    ['Breaker enchufable 1x20 A', 'und', 14500], ['Caja octagonal PVC', 'und', 1300],
  ],
  PLO: [
    ['Tubo PVC presión 1/2" x 6 m', 'und', 14800], ['Tubo PVC sanitario 4" x 3 m', 'und', 38500],
    ['Codo PVC presión 1/2"', 'und', 450], ['Unión PVC presión 1/2"', 'und', 380],
    ['Llave de paso 1/2"', 'und', 12900], ['Cinta teflón 3/4"', 'und', 900],
    ['Pegante PVC 1/32 de galón', 'und', 11200], ['Sifón plástico para lavaplatos', 'und', 8600],
  ],
  PIN: [
    ['Vinilo blanco tipo 1 galón', 'gal', 38500], ['Esmalte sintético negro galón', 'gal', 56000],
    ['Rodillo 9" con felpa', 'und', 7600], ['Brocha 3" cerda natural', 'und', 5400],
    ['Lija al agua No. 220', 'und', 1100], ['Thinner galón', 'gal', 21500],
    ['Masilla plástica 1/4 de galón', 'und', 15800], ['Cinta de enmascarar 24 mm', 'und', 3400],
  ],
  SEG: [
    ['Casco de seguridad amarillo', 'und', 14500], ['Gafas de seguridad claras', 'und', 5200],
    ['Guantes de carnaza', 'par', 8900], ['Tapabocas N95 caja x20', 'caja', 38000],
    ['Botas dieléctricas', 'par', 94000], ['Chaleco reflectivo', 'und', 12500],
    ['Protector auditivo de copa', 'und', 17800], ['Arnés de cuerpo completo', 'und', 168000],
  ],
  ASE: [
    ['Detergente en polvo 5 kg', 'und', 31500], ['Jabón líquido para manos 1 L', 'und', 9800],
    ['Desinfectante aroma pino 4 L', 'und', 14200], ['Escoba de cerda dura', 'und', 8500],
    ['Trapero de algodón', 'und', 7400], ['Bolsa de basura jumbo paquete x10', 'paq', 6900],
    ['Papel higiénico institucional x12', 'paq', 28500], ['Guantes de caucho', 'par', 4200],
  ],
  EMP: [
    ['Caja de cartón 40x30x30 cm', 'und', 2800], ['Cinta de empaque transparente 48 mm', 'und', 2300],
    ['Película stretch 18"', 'rollo', 24500], ['Bolsa de polietileno 40x60 paquete x100', 'paq', 11800],
    ['Estiba plástica 1,2 x 1 m', 'und', 82000], ['Cinta de embalaje con aviso frágil', 'und', 3100],
    ['Bolsa de burbuja rollo 1 m', 'rollo', 31000], ['Zuncho plástico rollo', 'rollo', 36000],
  ],
};
