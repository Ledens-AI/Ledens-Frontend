-- Segundo factor propio (TOTP + códigos de recuperación). Obligatorio para
-- Ledens Capital (src/capital/), opcional para el resto de la plataforma.
-- El secreto se guarda cifrado con MFA_ENCRYPTION_KEY (src/auth/totp.js);
-- de los códigos de recuperación, solo su SHA-256.
CREATE TABLE user_mfa_totp (
  user_id         uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_enc      text        NOT NULL,
  confirmed_at    timestamptz,
  -- Último paso de 30 s aceptado: un código ya usado no vale dos veces.
  last_step       bigint,
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_mfa_recovery_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text        NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_mfa_recovery_codes_user_idx ON user_mfa_recovery_codes (user_id);

-- Una sesión empieza sin segundo factor; se marca al verificarlo. Las rutas
-- que lo exigen comprueban esta columna, no la cuenta.
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
