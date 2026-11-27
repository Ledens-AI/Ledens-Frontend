-- Aviso por email de cada alta de usuario. A user counts as registered from the
-- moment users.registered_at is set (migration 024): the first session of an
-- account created by a password registration, a Google/Microsoft login, an
-- accepted invitation or a link to share an obra, or a password registration
-- that takes a row the team had prepared. That moment queues one message in
-- the transaction-alert queue (011, NOTIFICATIONS.md) with only the user id;
-- the mail itself is built when the Logic App claims it
-- (notifications/altas.js) and goes to its own recipient. Once per user
-- (event_key), never for the accounts already registered when this runs.
CREATE FUNCTION public.queue_user_registered_alert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.registered_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.registered_at IS NOT NULL) THEN RETURN NEW; END IF;
  INSERT INTO ledens.transaction_alerts (event_key, event_type, status, payload)
  VALUES ('user_registered:' || NEW.id, 'user_registered', 'registered', jsonb_build_object('user_id', NEW.id))
  ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER users_registered_alert AFTER INSERT OR UPDATE OF registered_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.queue_user_registered_alert();
