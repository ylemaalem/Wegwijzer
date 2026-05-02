-- Migration 054: Web Push Notificaties
-- Tabellen voor push subscriptions en verzend-log

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL,
  tenant_id    UUID        NOT NULL,
  endpoint     TEXT        NOT NULL,
  p256dh       TEXT        NOT NULL,
  auth         TEXT        NOT NULL,
  user_agent   TEXT,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS push_sub_user_idx   ON public.push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS push_sub_tenant_idx ON public.push_subscriptions (tenant_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_sub_own"
  ON public.push_subscriptions FOR ALL
  USING (user_id = auth.uid());

-- ----

CREATE TABLE IF NOT EXISTS public.push_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  user_id     UUID,
  event_type  TEXT        NOT NULL,
  payload     JSONB,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_log_dedup_idx
  ON public.push_log (tenant_id, user_id, event_type, sent_at);

ALTER TABLE public.push_log ENABLE ROW LEVEL SECURITY;

-- push_log uitsluitend toegankelijk via service role
CREATE POLICY "push_log_deny_all"
  ON public.push_log FOR ALL
  USING (false);
