# CODING AGENTS: READ THIS FIRST

Paquete de traspaso de **Ledens Capital**, la plataforma privada de coinversión inmobiliaria (por invitación), diseñada en un lienzo de Claude Design:
https://claude.ai/artifact/PgmGZJaYfYqs4ge7Tb5Muq

- `project/*.dc.html`: las 9 pantallas del lienzo, copiadas tal cual. Son prototipos (HTML con plantillas `{{…}}` y una clase `Component` con la lógica local), no código de producción: recrea su aspecto y comportamiento con la tecnología del frontend de destino, no su estructura interna.
- `project/canvas.json`: índice del lienzo (orden y nombre de cada pantalla).
- `SPEC.md`: **léelo antes de escribir código.** Alcance, reglas de producto, modelo de datos, motor de cálculo, API propuesta y decisiones abiertas.

Si el lienzo cambia, el lienzo manda: vuelve a leerlo con la herramienta Artifact (`project/canvas.json` y cada `project/*.dc.html`) y actualiza esta copia.

## Orden de lectura

1. `SPEC.md`
2. `project/Main.dc.html`: dirección visual, tokens (incluido el oro Capital) y componentes.
3. `project/Arquitectura.dc.html`: mapa del sitio, roles, recorridos y roadmap.
4. Las pantallas prioritarias: `Dashboard`, `Oportunidades`, `Proyecto` y `Simulador`.
5. `Acceso`, `Compromiso` y `Admin`.

No hace falta renderizar los archivos: colores, medidas y lógica están en el propio código.

## Avisos

- Todos los datos son ficticios. Los textos de demostración («Prototipo de demostración…») deben desaparecer en producción, salvo en entornos de prueba.
- La estructura legal (cuentas en participación, arts. 239–243 CCom), la elegibilidad de inversores, los contratos y la fiscalidad están **pendientes de validación por asesores legales y financieros españoles**. No codifiques una estructura de distribución como definitiva.
