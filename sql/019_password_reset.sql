-- =============================================
-- 019: password_reset_codes — "esqueci minha senha" por código via e-mail
-- =============================================
-- Fluxo: POST /api/auth/forgot-password  -> grava uma linha (e envia o código)
--        POST /api/auth/verify-reset-code -> valida o código, emite um token
--        POST /api/auth/reset-password    -> consome o token e troca a senha
--
-- Somente o servidor (service-role) acessa esta tabela: RLS ligado e NENHUMA
-- policy => clientes do navegador (anon/authenticated) não leem nem escrevem.
-- Nada sensível é guardado em claro: código, token e IP ficam como HMAC-SHA256
-- (segredo PASSWORD_RESET_SECRET, só no servidor).
--
-- Linhas também são gravadas para e-mails INEXISTENTES (user_id e code_hash
-- nulos, nada é enviado) para que o rate limit se comporte igual nos dois casos
-- e a API não permita descobrir quais e-mails existem.

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash        TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ NOT NULL,
  reset_token_hash TEXT,
  reset_expires_at TIMESTAMPTZ,
  consumed_at      TIMESTAMPTZ,
  ip_hash          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_email ON password_reset_codes(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_ip    ON password_reset_codes(ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_codes(reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;

ALTER TABLE password_reset_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON password_reset_codes FROM anon, authenticated;

-- Conta uma tentativa de código de forma atômica (evita corrida entre
-- tentativas simultâneas). Retorna o nº de tentativas já usadas, ou NULL se o
-- limite (5) foi atingido / o código expirou / já foi usado.
CREATE OR REPLACE FUNCTION bump_password_reset_attempt(p_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  UPDATE password_reset_codes
     SET attempts = attempts + 1
   WHERE id = p_id
     AND attempts < 5
     AND consumed_at IS NULL
     AND reset_token_hash IS NULL
     AND expires_at > NOW()
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION bump_password_reset_attempt(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bump_password_reset_attempt(UUID) TO service_role;

-- Limpeza opcional (rode periodicamente ou via pg_cron):
--   DELETE FROM password_reset_codes WHERE created_at < NOW() - INTERVAL '7 days';
