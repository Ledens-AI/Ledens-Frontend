// The company that issues the invoices, as printed on the example invoice
// 4T2026-347. Every invoice keeps a copy of the data it was issued with
// (facturas.emisor), so a change here only affects invoices issued afterwards.
export const EMISOR = Object.freeze({
  nombre: 'Sociedad Inversora Navarro Robinson SL',
  cif: 'B19753805',
  direccion: 'Av de Sor Teresa Prat, 15, Carretera de Cádiz, 29003 Málaga',
  telefono: '632629122',
  email: 'ajnavarrosilva@gmail.com',
  iban: 'ES43 1583 0001 1893 7510 2265',
});

export const NOTA_LEGAL = 'En cumplimiento de la Ley 37/1992 del IVA y el Real Decreto 1619/2012 sobre obligaciones de facturación, esta factura constituye un documento mercantil válido.';
