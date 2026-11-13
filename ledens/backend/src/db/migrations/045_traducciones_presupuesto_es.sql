-- Presupuestos are read in Spanish too when some lines were written in another
-- language (an ampliación typed in English): the same cache now also keeps the
-- Spanish of each text (src/presupuestos/traducciones.js). Only the allowed
-- languages change.
ALTER TABLE presupuesto_traducciones DROP CONSTRAINT IF EXISTS presupuesto_traducciones_lang_check;
ALTER TABLE presupuesto_traducciones ADD CONSTRAINT presupuesto_traducciones_lang_check CHECK (lang IN ('en', 'es'));
