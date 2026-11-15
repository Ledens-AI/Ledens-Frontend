import { audit } from '../db/audit.js';

// First values of the recetas (herramientas + materiales) of the partidas that
// exist in the base, by rule: the partida's name (else its category and
// description) says what kind of work it is, its unit which recipe applies.
// They are a starting point that the team corrects from «Partidas»; a partida
// that no rule recognises keeps an empty receta. Quantities are per one unit
// of the partida (m², ml, ud, m³) with usual Spanish construction yields;
// waste (merma) is a percentage on top.
//
// Used once at startup for every existing partida (recetas.js,
// runRecetasInicialesOnce) and for every partida created in the base later.

// Tool name → category of its Ledens Tools type (inventory.tool_types).
export const TOOLS = {
  'Rodillo de pintura': 'Pintura', 'Brocha': 'Pintura', 'Bandeja de pintura': 'Pintura', 'Alargador telescópico para rodillo': 'Pintura',
  'Espátula': 'Albañilería', 'Llana': 'Albañilería', 'Llana dentada': 'Albañilería', 'Talocha': 'Albañilería', 'Paleta de albañil': 'Albañilería',
  'Regla de aluminio': 'Albañilería', 'Mazo de goma': 'Albañilería', 'Cubos de obra': 'Albañilería', 'Carretilla': 'Albañilería', 'Pala': 'Albañilería',
  'Nivel de burbuja': 'Medición', 'Nivel láser': 'Medición', 'Cinta métrica': 'Medición', 'Plomada': 'Medición', 'Escuadra': 'Medición',
  'Batidora mezcladora': 'Herramienta eléctrica', 'Taladro percutor': 'Herramienta eléctrica', 'Atornillador': 'Herramienta eléctrica', 'Lijadora': 'Herramienta eléctrica',
  'Hormigonera': 'Maquinaria', 'Vibrador de hormigón': 'Maquinaria',
  'Escalera de tijera': 'Elevación y acceso', 'Escalera extensible': 'Elevación y acceso', 'Andamio': 'Elevación y acceso', 'Andamio de borriquetas': 'Elevación y acceso',
  'Arnés y línea de vida': 'Seguridad',
  'Cortadora de azulejos': 'Corte', 'Amoladora (radial)': 'Corte', 'Ingletadora': 'Corte', 'Sierra de calar': 'Corte', 'Cúter': 'Corte', 'Tijera de chapa': 'Corte', 'Rozadora': 'Corte',
  'Martillo demoledor': 'Demolición', 'Maza y cincel': 'Demolición', 'Palanca (pata de cabra)': 'Demolición',
  'Cortatubos': 'Fontanería', 'Prensadora de multicapa': 'Fontanería', 'Llave grifa': 'Fontanería', 'Llave inglesa': 'Fontanería', 'Soplete': 'Fontanería',
  'Polímetro': 'Electricidad', 'Pelacables': 'Electricidad', 'Alicates': 'Electricidad', 'Destornilladores aislados': 'Electricidad', 'Guía pasacables': 'Electricidad',
  'Pistola de silicona': 'Carpintería', 'Pistola de espuma': 'Carpintería', 'Kit de instalación de tarima': 'Carpintería',
  'Soldadora': 'Soldadura', 'Aspirador industrial': 'Limpieza', 'Escoba y recogedor': 'Limpieza', 'Fregona y cubo': 'Limpieza',
  'Bomba de vacío': 'Climatización', 'Juego de manómetros': 'Climatización', 'Abocardador': 'Climatización',
};

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/²/g, '2').replace(/³/g, '3').replace(/\s+/g, ' ').trim();

// m2 | ml | m3 | ud | kg | pa (partida alzada) | h | null
export function unitFamily(unit) {
  const s = norm(unit).replace(/[.\s]/g, '');
  if (!s) return null;
  if (/^(m2|mt2|mts2|metro2|metros2)$|cuadrad/.test(s)) return 'm2';
  if (/^(m3|mt3|mts3)$|cubic/.test(s)) return 'm3';
  if (/^(ml|m|mt|mts|metro|metros|mlineal|metrolineal|metroslineales)$|lineal/.test(s)) return 'ml';
  if (/^(ud|uds|u|un|und|uni|unidad|unidades|pza|pieza|piezas|punto|puntos|pto|ptos)$/.test(s)) return 'ud';
  if (/^(kg|kgs|kilo|kilos)$/.test(s)) return 'kg';
  if (/^(pa|partida|partidaalzada|alzada|global|gl)$/.test(s)) return 'pa';
  if (/^(h|hr|hora|horas)$/.test(s)) return 'h';
  return null;
}

// [name, unit, quantity per unit of the partida, waste %]
const M = (name, unit, quantity, waste = 0) => ({ name, unit, quantity, waste });

// Ordered: the first rule whose `match` fits the partida's name wins (the
// specific ones first: «retirada de azulejos» is a demolition, not tiling).
export const RULES = [
  { id: 'escombros', match: /escombro|contenedor|residuo|vertedero|desescombr/,
    tools: ['Carretilla', 'Pala', 'Cubos de obra'],
    mat: { m3: [M('Saco de escombros (big bag 1 m³)', 'ud', 1.2)], m2: [M('Saco de escombros (big bag 1 m³)', 'ud', 0.05)] } },
  { id: 'proteccion', match: /proteccion de|protecciones|proteger/,
    tools: ['Cúter', 'Cinta métrica'],
    mat: { m2: [M('Cartón o plástico protector', 'm²', 1.1), M('Cinta adhesiva', 'm', 0.5)], ml: [M('Cartón o plástico protector', 'm²', 0.3), M('Cinta adhesiva', 'm', 1)] } },
  { id: 'demolicion', match: /demol|derrib|picad|retirad|desmont|arranqu|levantad|desmantel|eliminacion de|quitar/,
    tools: ['Martillo demoledor', 'Maza y cincel', 'Palanca (pata de cabra)', 'Amoladora (radial)', 'Carretilla', 'Pala', 'Cubos de obra'],
    mat: { m2: [M('Saco de escombros (big bag 1 m³)', 'ud', 0.05), M('Plástico protector', 'm²', 0.5)],
      ml: [M('Saco de escombros (big bag 1 m³)', 'ud', 0.02)], m3: [M('Saco de escombros (big bag 1 m³)', 'ud', 1.3)],
      ud: [M('Saco de escombros (big bag 1 m³)', 'ud', 0.1)] } },
  { id: 'limpieza', match: /limpiez|limpiar/,
    tools: ['Aspirador industrial', 'Escoba y recogedor', 'Fregona y cubo'],
    mat: { m2: [M('Producto de limpieza', 'l', 0.02), M('Bolsas de basura', 'ud', 0.05)] } },
  { id: 'impermeabilizacion', match: /impermeab|lamina asfalt|tela asfalt|membrana|caucho liquido|estanqueid/,
    tools: ['Rodillo de pintura', 'Brocha', 'Llana', 'Cúter', 'Soplete'],
    mat: { m2: [M('Lámina o membrana impermeabilizante', 'm²', 1.15), M('Imprimación', 'kg', 0.3), M('Banda de refuerzo', 'm', 0.3)],
      ml: [M('Banda de refuerzo', 'm', 1.1), M('Membrana impermeabilizante líquida', 'kg', 0.4)] } },
  { id: 'esmalte', match: /esmalt|barniz|lacad|lasur|tratamiento de madera|antioxid/,
    tools: ['Brocha', 'Rodillo de pintura', 'Lijadora', 'Espátula'],
    mat: { m2: [M('Esmalte o barniz', 'l', 0.15, 5), M('Imprimación', 'l', 0.1), M('Lija', 'ud', 0.3), M('Cinta de carrocero', 'm', 0.5)],
      ml: [M('Esmalte o barniz', 'l', 0.04, 5), M('Lija', 'ud', 0.1)], ud: [M('Esmalte o barniz', 'l', 0.5, 5), M('Lija', 'ud', 1)] } },
  { id: 'pintura', match: /pint|plastica|gotele|temple/,
    tools: ['Rodillo de pintura', 'Brocha', 'Bandeja de pintura', 'Alargador telescópico para rodillo', 'Escalera de tijera', 'Espátula'],
    mat: { m2: [M('Pintura plástica', 'l', 0.25, 5), M('Imprimación o fijador', 'l', 0.12), M('Masilla de reparación', 'kg', 0.05), M('Cinta de carrocero', 'm', 0.3), M('Plástico protector', 'm²', 0.5)],
      ml: [M('Pintura plástica', 'l', 0.05, 5), M('Cinta de carrocero', 'm', 1)], ud: [M('Pintura plástica', 'l', 2.5, 5), M('Cinta de carrocero', 'm', 3)] },
    exterior: { m2: [M('Pintura de exterior (fachada)', 'l', 0.3, 5), M('Imprimación o fijador', 'l', 0.15), M('Masilla de reparación', 'kg', 0.05), M('Cinta de carrocero', 'm', 0.3), M('Plástico protector', 'm²', 0.5)] } },
  { id: 'alisado', match: /alisad|masill|plaste|empast|enlucido fino/,
    tools: ['Llana', 'Espátula', 'Lijadora', 'Escalera de tijera', 'Batidora mezcladora', 'Cubos de obra'],
    mat: { m2: [M('Masilla o plaste en polvo', 'kg', 1, 5), M('Lija', 'ud', 0.2)] } },
  { id: 'pladur', match: /pladur|yeso laminad|placa de yeso|cartón yeso|carton yeso|trasdosad|falso techo|techo continuo|tabique seco|tabiqueria seca/,
    tools: ['Atornillador', 'Cúter', 'Tijera de chapa', 'Nivel láser', 'Cinta métrica', 'Llana', 'Espátula', 'Escalera de tijera'],
    mat: { m2: [M('Placa de yeso laminado', 'm²', 2.1, 5), M('Perfil montante', 'm', 2), M('Canal', 'm', 0.8), M('Tornillos para placa', 'ud', 25), M('Cinta de juntas', 'm', 1.5), M('Pasta de juntas', 'kg', 0.6), M('Lana mineral', 'm²', 1, 3)],
      ml: [M('Placa de yeso laminado', 'm²', 0.5, 5), M('Perfil', 'm', 2), M('Tornillos para placa', 'ud', 10), M('Pasta de juntas', 'kg', 0.2)] },
    variants: [
      { match: /techo/, m2: [M('Placa de yeso laminado', 'm²', 1.05, 5), M('Perfil primario y secundario', 'm', 3.2), M('Cuelgue o varilla', 'ud', 1.2), M('Tornillos para placa', 'ud', 15), M('Cinta de juntas', 'm', 1.5), M('Pasta de juntas', 'kg', 0.4)] },
      { match: /trasdos/, m2: [M('Placa de yeso laminado', 'm²', 1.05, 5), M('Perfil montante', 'm', 1.2), M('Canal', 'm', 0.8), M('Tornillos para placa', 'ud', 15), M('Cinta de juntas', 'm', 1.5), M('Pasta de juntas', 'kg', 0.4), M('Lana mineral', 'm²', 1, 3)] },
    ] },
  { id: 'rodapie', match: /rodapi|zocalo|cubrecant|tapajunt/,
    tools: ['Ingletadora', 'Pistola de silicona', 'Cinta métrica', 'Nivel de burbuja'],
    mat: { ml: [M('Rodapié', 'm', 1, 5), M('Adhesivo de montaje (cartucho)', 'ud', 0.08)], ud: [M('Pieza', 'ud', 1, 5)] } },
  { id: 'climatizacion', match: /aire acondicionado|climatiz|split|conducto|calefacc|radiador|caldera|aerotermia|suelo radiante|bomba de calor|ventilacion|extractor/,
    tools: ['Bomba de vacío', 'Juego de manómetros', 'Abocardador', 'Taladro percutor', 'Nivel de burbuja', 'Escalera de tijera'],
    mat: { ud: [M('Equipo (según modelo elegido)', 'ud', 1), M('Tubería frigorífica', 'm', 3, 10), M('Soportes y anclajes', 'ud', 1)],
      ml: [M('Conducto o tubería', 'm', 1, 5), M('Soportes y anclajes', 'ud', 1)], m2: [M('Tubo de suelo radiante', 'm', 6, 5), M('Panel aislante', 'm²', 1.05, 3)] } },
  { id: 'tarima', match: /tarima|parquet|laminad|vinilic|vinilo|spc|lvt|suelo flotante/,
    tools: ['Ingletadora', 'Sierra de calar', 'Kit de instalación de tarima', 'Mazo de goma', 'Cinta métrica', 'Cúter'],
    mat: { m2: [M('Tarima o suelo laminado', 'm²', 1, 7), M('Lámina base aislante', 'm²', 1.05), M('Cinta adhesiva para lámina', 'm', 0.5)] } },
  { id: 'alicatado', match: /alicat|azulej|revestimiento ceram|plaqueta|chapad|mosaico|gresite/,
    tools: ['Cortadora de azulejos', 'Amoladora (radial)', 'Llana dentada', 'Paleta de albañil', 'Nivel de burbuja', 'Mazo de goma', 'Batidora mezcladora', 'Cubos de obra'],
    mat: { m2: [M('Azulejo o revestimiento cerámico', 'm²', 1, 10), M('Adhesivo cementoso C2', 'kg', 5), M('Material de rejuntado', 'kg', 0.5), M('Crucetas o niveladores', 'ud', 12)],
      ml: [M('Pieza cerámica o perfil de remate', 'm', 1, 10), M('Adhesivo cementoso C2', 'kg', 1)] } },
  { id: 'solado', match: /solad|pavimento|suelo|porcelan|gres|baldos|terrazo|marmol|piedra natural/,
    tools: ['Cortadora de azulejos', 'Amoladora (radial)', 'Llana dentada', 'Paleta de albañil', 'Nivel láser', 'Mazo de goma', 'Batidora mezcladora', 'Cubos de obra'],
    mat: { m2: [M('Baldosa o pavimento', 'm²', 1, 8), M('Adhesivo cementoso C2', 'kg', 6), M('Material de rejuntado', 'kg', 0.5), M('Crucetas o niveladores', 'ud', 10)],
      ml: [M('Pieza de pavimento', 'm', 1, 8), M('Adhesivo cementoso C2', 'kg', 1.5)] } },
  { id: 'hormigon', match: /hormig|solera|recrecid|cimenta|zapata|forjado|losa|autonivel|capa de compresion|mortero de nivelacion|nivelacion de suelo/,
    tools: ['Hormigonera', 'Regla de aluminio', 'Llana', 'Carretilla', 'Pala', 'Nivel láser', 'Vibrador de hormigón'],
    mat: { m2: [M('Hormigón', 'm³', 0.1, 5), M('Mallazo electrosoldado', 'm²', 1.1), M('Lámina de polietileno', 'm²', 1.1)], m3: [M('Hormigón', 'm³', 1, 5), M('Acero corrugado', 'kg', 40, 5)] },
    variants: [{ match: /autonivel|recrecid|nivelacion/, m2: [M('Mortero autonivelante', 'kg', 8, 5), M('Imprimación', 'kg', 0.15)] }] },
  { id: 'enfoscado', match: /enfosc|revoc|monocapa|mortero|raseo|enlucido de mortero/,
    tools: ['Paleta de albañil', 'Llana', 'Talocha', 'Regla de aluminio', 'Hormigonera', 'Cubos de obra', 'Carretilla'],
    mat: { m2: [M('Mortero', 'kg', 25, 5), M('Malla de fibra de vidrio', 'm²', 0.2)] } },
  { id: 'yeso', match: /guarnec|enluc|yeso|enyesad/,
    tools: ['Llana', 'Talocha', 'Regla de aluminio', 'Batidora mezcladora', 'Cubos de obra', 'Andamio de borriquetas'],
    mat: { m2: [M('Yeso', 'kg', 12, 5), M('Guardavivos', 'm', 0.3)] } },
  { id: 'fabrica', match: /ladrill|tabique|tabicon|fabrica|bloque|citara|muro/,
    tools: ['Paleta de albañil', 'Nivel de burbuja', 'Plomada', 'Regla de aluminio', 'Hormigonera', 'Carretilla', 'Cubos de obra', 'Amoladora (radial)'],
    mat: { m2: [M('Ladrillo', 'ud', 33, 5), M('Mortero', 'm³', 0.02, 5)], ml: [M('Ladrillo', 'ud', 12, 5), M('Mortero', 'm³', 0.008, 5)] } },
  { id: 'aislamiento', match: /aislam|lana mineral|lana de roca|xps|eps|poliestir|poliuretano proyect|sate|termico|acustico/,
    tools: ['Cúter', 'Llana dentada', 'Taladro percutor', 'Cinta métrica'],
    mat: { m2: [M('Panel aislante', 'm²', 1.05, 3), M('Fijaciones mecánicas', 'ud', 6), M('Adhesivo para aislamiento', 'kg', 4)] } },
  { id: 'cubierta', match: /cubierta|tejad|teja|canalon|bajante pluvial|limahoya|cumbrera/,
    tools: ['Andamio', 'Arnés y línea de vida', 'Amoladora (radial)', 'Paleta de albañil', 'Tijera de chapa', 'Escalera extensible'],
    mat: { m2: [M('Teja', 'ud', 11, 5), M('Mortero', 'kg', 10, 5)], ml: [M('Canalón o pieza de remate', 'm', 1, 5), M('Soportes o ganchos', 'ud', 2)] } },
  { id: 'sanitarios', match: /inodoro|lavabo|bide|plato de ducha|banera|grifo|griferia|mampara|sanitari|fregadero|termo|calentador|ducha|vater|wc|mueble de bano/,
    tools: ['Llave inglesa', 'Llave grifa', 'Taladro percutor', 'Nivel de burbuja', 'Pistola de silicona'],
    mat: { ud: [M('Aparato o pieza (según modelo elegido)', 'ud', 1), M('Silicona sanitaria (cartucho)', 'ud', 0.3), M('Latiguillo', 'ud', 2), M('Llave de escuadra', 'ud', 2), M('Tacos y tornillos', 'ud', 4)] } },
  { id: 'fontaneria', match: /fontaner|tuberi|agua fria|agua caliente|multicapa|desag|saneamiento|bajante|tubo de pvc|cobre|polipropileno|punto de agua|toma de agua|arqueta|sifon/,
    tools: ['Cortatubos', 'Prensadora de multicapa', 'Llave grifa', 'Taladro percutor', 'Rozadora', 'Sierra de calar', 'Nivel de burbuja'],
    mat: { ml: [M('Tubería', 'm', 1, 5), M('Accesorios de unión', 'ud', 0.3), M('Abrazaderas', 'ud', 1), M('Coquilla aislante', 'm', 1)],
      ud: [M('Tubería', 'm', 6, 5), M('Accesorios de unión', 'ud', 4), M('Abrazaderas', 'ud', 4), M('Llave de corte', 'ud', 1)] },
    variants: [{ match: /desag|saneamiento|bajante|tubo de pvc|sifon/, ml: [M('Tubo de PVC', 'm', 1, 5), M('Codos y accesorios de PVC', 'ud', 0.3), M('Adhesivo para PVC', 'ud', 0.02), M('Abrazaderas', 'ud', 1)],
      ud: [M('Tubo de PVC', 'm', 2, 5), M('Codos y accesorios de PVC', 'ud', 2), M('Adhesivo para PVC', 'ud', 0.05)] }] },
  { id: 'electricidad', match: /electric|enchufe|toma de corriente|interruptor|conmutador|punto de luz|cablead|cuadro|mecanism|luminaria|foco|led|iluminacion|alumbrado|telecomunic|antena|portero|videoportero/,
    tools: ['Polímetro', 'Pelacables', 'Alicates', 'Destornilladores aislados', 'Guía pasacables', 'Taladro percutor', 'Rozadora', 'Escalera de tijera'],
    mat: { ud: [M('Cable de 2,5 mm²', 'm', 15, 5), M('Tubo corrugado', 'm', 6, 5), M('Caja de mecanismo', 'ud', 1), M('Mecanismo', 'ud', 1), M('Bornes de conexión', 'ud', 3)],
      ml: [M('Cable', 'm', 3, 5), M('Tubo corrugado', 'm', 1, 5)] },
    variants: [{ match: /luminaria|foco|led|iluminacion|alumbrado|lampara/, ud: [M('Luminaria (según modelo elegido)', 'ud', 1), M('Bornes de conexión', 'ud', 2), M('Tacos y tornillos', 'ud', 2)] }] },
  { id: 'carpinteria', match: /puerta|ventana|carpinter|premarco|marco|armario|frente de armario|persiana|contraventan|vidrio|acristal/,
    tools: ['Taladro percutor', 'Atornillador', 'Nivel de burbuja', 'Ingletadora', 'Pistola de espuma', 'Pistola de silicona', 'Escuadra'],
    mat: { ud: [M('Puerta o ventana (según medida)', 'ud', 1), M('Espuma de poliuretano', 'ud', 0.5), M('Silicona (cartucho)', 'ud', 0.5), M('Tacos y tornillos', 'ud', 8), M('Cuñas de montaje', 'ud', 6)],
      m2: [M('Carpintería (según medida)', 'm²', 1), M('Espuma de poliuretano', 'ud', 0.3), M('Silicona (cartucho)', 'ud', 0.4), M('Tacos y tornillos', 'ud', 6)],
      ml: [M('Perfil o tapajuntas', 'm', 1, 5), M('Tacos y tornillos', 'ud', 2)] } },
  { id: 'cerrajeria', match: /barandill|reja|cerrajer|metalic|soldad|estructura de acero|perfil de acero|pasamanos/,
    tools: ['Soldadora', 'Amoladora (radial)', 'Taladro percutor', 'Nivel de burbuja', 'Cinta métrica'],
    mat: { ml: [M('Perfil metálico', 'm', 1, 5), M('Anclaje químico', 'ud', 2), M('Imprimación antioxidante', 'l', 0.1)],
      m2: [M('Estructura metálica (según diseño)', 'm²', 1), M('Anclaje químico', 'ud', 3), M('Imprimación antioxidante', 'l', 0.2)], ud: [M('Pieza metálica (según diseño)', 'ud', 1), M('Anclaje químico', 'ud', 4)] } },
  { id: 'cocina', match: /cocina|encimera|mueble|electrodomest|campana/,
    tools: ['Taladro percutor', 'Atornillador', 'Nivel de burbuja', 'Sierra de calar', 'Pistola de silicona'],
    mat: { ud: [M('Mueble o pieza (según modelo elegido)', 'ud', 1), M('Tacos y tornillos', 'ud', 10), M('Silicona (cartucho)', 'ud', 0.3)],
      ml: [M('Encimera o mueble (según modelo elegido)', 'm', 1, 3), M('Tacos y tornillos', 'ud', 6), M('Silicona (cartucho)', 'ud', 0.3)] } },
  { id: 'medios', match: /andamio|medios auxiliares|seguridad y salud|lona/,
    tools: ['Andamio', 'Arnés y línea de vida'], mat: {} },
];

const EXTERIOR = /fachada|exterior|cubierta|tejado|patio|terraza|azotea|medianera/;
const HIGH = /fachada|medianera|cubierta|tejado|azotea|altura|patio de luces/;

const ruleFor = (text) => RULES.find((r) => r.match.test(text)) || null;

// The receta of one partida: { rule, tools: [name], materials: [{ name, unit, quantity, waste }] }, or null.
export function recetaInicial({ name, categoria, definicion, unit }) {
  const n = norm(name);
  const rule = ruleFor(n) || ruleFor(norm(categoria)) || ruleFor(norm(definicion));
  if (!rule) return null;
  const all = `${n} ${norm(definicion)}`;
  const fam = unitFamily(unit);
  const tools = [...rule.tools];
  if (HIGH.test(all)) for (const t of ['Andamio', 'Escalera extensible']) if (!tools.includes(t)) tools.push(t);
  if (/cubierta|tejado|azotea/.test(all) && !tools.includes('Arnés y línea de vida')) tools.push('Arnés y línea de vida');
  if (/techo/.test(all) && !tools.some((t) => /^Andamio|Escalera/.test(t))) tools.push('Escalera de tijera');
  let mat = fam ? rule.mat[fam] : null;
  const variant = (rule.variants || []).find((v) => v.match.test(all) && fam && v[fam]);
  if (variant) mat = variant[fam];
  else if (rule.exterior && EXTERIOR.test(all) && fam && rule.exterior[fam]) mat = rule.exterior[fam];
  return { rule: rule.id, tools, materials: (mat || []).map((m) => ({ ...m })) };
}

// Finds (by name, any tracking) or creates the Ledens Tools type of a tool.
export async function toolType(db, name, category) {
  const found = (await db.query(`SELECT id, name, category, tracking FROM inventory.tool_types WHERE lower(btrim(name))=lower(btrim($1))
                                  ORDER BY active DESC, (tracking='individual') DESC, created_at LIMIT 1`, [name])).rows[0];
  if (found) return { ...found, created: false };
  const r = (await db.query(`INSERT INTO inventory.tool_types (name, category, tracking) VALUES ($1,$2,'individual')
                              ON CONFLICT DO NOTHING RETURNING id, name, category, tracking`, [name, category || TOOLS[name] || 'General'])).rows[0];
  return r ? { ...r, created: true } : toolType(db, name, category);
}

// First recetas, by rule (recetasIniciales.js), for the partidas of the base
// that have none yet (no tool and no material). `codes` limits it to some
// partidas (a partida just created). Tools missing from Ledens Tools are
// created as types. Never touches a receta that already has a row.
export async function seedRecetas(db, { codes = null, simulate = false, actorLabel = 'Sistema (recetas iniciales)' } = {}) {
  const args = codes ? [codes] : [];
  const rows = (await db.query(`SELECT DISTINCT ON (w.id_partida) w.id_partida code, w.name, w.categoria, to_jsonb(w)->>'definicion_partida' definicion, w.unit_source unit
                                  FROM ledens.work_items w
                                 WHERE w.id_partida ~ '^PA-\\d+$' ${codes ? 'AND w.id_partida=ANY($1::text[])' : ''}
                                   AND NOT EXISTS (SELECT 1 FROM partida_herramientas h WHERE h.base_code=w.id_partida)
                                   AND NOT EXISTS (SELECT 1 FROM partida_materiales m WHERE m.base_code=w.id_partida)
                                 ORDER BY w.id_partida, w.id`, args)).rows;
  const out = { partidas: rows.length, conReceta: 0, sinRegla: [], herramientas: 0, materiales: 0, tiposCreados: [] };
  const types = new Map();
  for (const r of rows) {
    const receta = recetaInicial(r);
    if (!receta) { out.sinRegla.push(r.code); continue; }
    out.conReceta++;
    if (simulate) { out.herramientas += receta.tools.length; out.materiales += receta.materials.length; continue; }
    let pos = 0;
    for (const name of receta.tools) {
      let t = types.get(name);
      if (!t) {
        t = await toolType(db, name);
        if (t.created) out.tiposCreados.push(name);
        types.set(name, t);
      }
      if (t.tracking === 'consumible') continue;
      const ins = await db.query(`INSERT INTO partida_herramientas (base_code, tool_type_id, quantity, position, origin) VALUES ($1,$2,1,$3,'inicial')
                                  ON CONFLICT DO NOTHING`, [r.code, t.id, ++pos]);
      out.herramientas += ins.rowCount || 0;
    }
    pos = 0;
    for (const m of receta.materials) {
      const ins = await db.query(`INSERT INTO partida_materiales (base_code, name, unit, quantity, waste_pct, position, origin) VALUES ($1,$2,$3,$4,$5,$6,'inicial')
                                  ON CONFLICT DO NOTHING`, [r.code, m.name, m.unit, m.quantity, m.waste, ++pos]);
      out.materiales += ins.rowCount || 0;
    }
  }
  if (!simulate && out.conReceta) {
    await audit({ actor: { label: actorLabel }, action: 'Recetas iniciales de partidas', target: { label: codes?.length === 1 ? codes[0] : null },
      detail: `${out.conReceta} de ${out.partidas} partidas con receta inicial · ${out.herramientas} herramientas · ${out.materiales} materiales${out.tiposCreados.length ? ` · tipos de herramienta creados: ${out.tiposCreados.join(', ')}` : ''}`.slice(0, 4000) }, db);
  }
  return out;
}

// A partida just created in the base (propuestas.js, createInBase) gets its
// first receta too. Skipped where the tables do not exist (tests, old databases).
export async function seedRecetaNueva(db, code) {
  const ok = (await db.query("SELECT to_regclass('public.partida_materiales') m, to_regclass('inventory.tool_types') t")).rows[0];
  if (!ok.m || !ok.t) return null;
  return seedRecetas(db, { codes: [code], actorLabel: 'Sistema (receta inicial de partida nueva)' });
}
