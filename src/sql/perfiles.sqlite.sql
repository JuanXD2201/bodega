-- Bodega · migración 2: perfiles de acceso locales con PIN opcional.
-- El PIN nunca se guarda: solo su hash PBKDF2-SHA-256 con sal propia de cada perfil.

ALTER TABLE usuarios ADD COLUMN pin_hash TEXT;
ALTER TABLE usuarios ADD COLUMN pin_sal TEXT;
ALTER TABLE usuarios ADD COLUMN pin_iteraciones INTEGER;
