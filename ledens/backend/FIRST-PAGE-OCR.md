# OCR de PDF largos

Los PDF genéricos con más de dos páginas ya no se rechazan por `f0_page_limit`: se crea una copia temporal de la primera página y solo esa copia se envía al OCR. Los PDF de una o dos páginas se mantienen como estaban. Los lectores nativos verificados (OBRAMAT y justificantes Revolut) conservan sus reglas propias.

El hash, el origen y el documento siguen correspondiendo al PDF completo. El archivo que mueve SharePoint es el original completo, nunca la copia de OCR. La ingesta conserva `document_evidence` con `source=azure-di`, `original_pages`, `pages=[1]`, `first_page_only=true` y el hash original; las líneas extraídas también señalan el alcance de página uno. No se inventan conceptos de páginas no leídas ni se asume que el desglose está completo.

Los documentos anteriormente bloqueados por `f0_page_limit` pueden reanudarse al recibir exactamente el mismo hash, conservando sus identificadores y fuentes. No se reabren automáticamente otras incidencias. Si la primera página no permite validar fecha, importe, moneda o sentido, permanece la protección de revisión sin archivo del PR 40.

Se mantiene el límite de 4 MB del servicio gratuito. No hay nueva migración ni variables de entorno. Pruebas: PDF largo → una página en el cuerpo HTTP de OCR; original y hash intactos; alcance persistido; reanudación de la misma ingesta sin duplicados; PDF cortos sin cambios; regresiones de facturas OBRAMAT y justificantes Revolut.
