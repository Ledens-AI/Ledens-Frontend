import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseObramatSale,parseObramatPages} from '../src/ingestion/obramat.js';
// A plain Obramat sale (a «Ticket de caja … Venta» invoice, no order), as its PDF text
// reads: a duplicate copy prints each header field twice on one line, the first page is
// a cover and the totals are on the last one. Synthetic text only.
const FOOT='Ejemplar cliente\nBRICOLAJE BRICOMAN, S.L.U. R.M. Madrid\nRAZON SOCIAL Calle Ejemplo, 1 C.I.F. B-84406289';
const pages=({rows,summary,buyer='B19753805',total='3'}={})=>[
 `FACTURA 008-0010-900001\nDUPLICADO\n${FOOT}`,
 `FACTURA 008-0010-900001\nDUPLICADO\nBRICOLAJE BRICOMAN S.L.U BRICOLAJE BRICOMAN S.L.U
Numero NIF Numero NIF : : ${buyer} ${buyer}
Fecha de venta Fecha de venta : : 05/10/2026 05/10/2026
Pag. 2 / ${total} Pag. 2 / ${total}
Ticket de caja Ticket de caja : : 008-000049-012-0001-NFS: 000001 05/10/2026 10:00 Venta 008-000049-012-0001-NFS: 000001 05/10/2026 10:00 Venta
N° Designacion y Referencia articulo Cantidad Unid. Prec. unid Descu. Unid. Total. SI Tasa Precio Importe
${rows}
${FOOT}`,
 `FACTURA 008-0010-900001\nDUPLICADO\nTasa IVA/IGIC/IPSI Total. SI Total IVA/IGIC/IPSI Total TTI (EUR)\n(EUR)\nModos de pagos\nTARJ. REDSYS SA(EUR) 60,50\n${summary}\n${FOOT}`,
 'CONDICIONES GENERALES\nLas presentes condiciones generales…'];
const ROWS=`1 SACO PRUEBA 25KG 10 UNID. 0,83 0,00 0,83 21.00 1,00 10,00
12345678
2 TABLERO PRUEBA 80x60 2 UNID. 20,87 0,00 20,87 21.00 25,25 50,50
12345679`;

test('a plain Obramat sale is read from its text: every product, its net and VAT from its group, adding up to the total',()=>{
 const {data}=parseObramatSale(pages({rows:ROWS,summary:'21.00 50.00 10.50 60,50'}));
 assert.deepEqual([data.kind,data.document_number,data.issued_on,data.gross,data.net,data.vat],['sale','008-0010-900001','2026-10-05','60.50','50.00','10.50']);
 assert.deepEqual(data.lines.map(l=>[l.line_number,l.quantity,l.product_code,l.gross_amount,l.net_amount,l.vat_amount]),
  [[1,10,'12345678','10.00','8.26','1.74'],[2,2,'12345679','50.50','41.74','8.76']]);
 assert.equal(data.lines[0].evidence.origin,'native-pdf-obramat-sale-v1');
 // Not a purchase document: the ingestion keeps reading it with the OCR.
 assert.equal(parseObramatPages(pages({rows:ROWS,summary:'21.00 50.00 10.50 60,50'})),null);
});

test('a line with a discount is read: its unit price is its total ÷ quantity rounded to the cent',()=>{
 // 12 × 6,90 with a 5 % discount is 78,66; the invoice prints 6,56 (6,555) as the unit price.
 const rows=`${ROWS}\n3 ADHESIVO PRUEBA 290ML 12 UNID. 5,70 0,28 5,42 21.00 6,56 78,66\n12345680`;
 const {data}=parseObramatSale(pages({rows,summary:'21.00 115.00 24.16 139,16'}));
 assert.deepEqual([data.gross,data.net,data.vat],['139.16','115.00','24.16']);
 assert.deepEqual(data.lines.map(l=>[l.line_number,l.quantity,l.gross_amount]),[[1,10,'10.00'],[2,2,'50.50'],[3,12,'78.66']]);
 // Its evidence has the same fields as any line: what was read before keeps its fingerprint.
 assert.deepEqual(Object.keys(data.lines[2].evidence),Object.keys(data.lines[0].evidence));
 // Beyond that rounding, or on a line without discount, it is still a misread.
 assert.equal(parseObramatSale(pages({rows:rows.replace('6,56 78,66','6,56 78,50'),summary:'21.00 114.87 24.13 139,00'})).reason,'sale_item_quantity_amount_mismatch');
 assert.equal(parseObramatSale(pages({rows:ROWS.replace('1,00 10,00','1,00 10,01'),summary:'21.00 50.01 10.50 60,51'})).reason,'sale_item_quantity_amount_mismatch');
});

test('a sale that does not add up, of another buyer or with a page missing is not read',()=>{
 assert.equal(parseObramatSale(pages({rows:ROWS,summary:'21.00 50.00 10.50 61,50'})).reason,'sale_tax_summary_missing');
 assert.equal(parseObramatSale(pages({rows:ROWS,summary:'21.00 50.00 10.50 60,50',buyer:'B00000000'})).reason,'sale_buyer_not_verified');
 assert.equal(parseObramatSale(pages({rows:ROWS,summary:'21.00 50.00 10.50 60,50',total:'4'})).reason,'sale_missing_invoice_page');
 assert.equal(parseObramatSale(['FACTURA 1\nOtra tienda']),null);
});
