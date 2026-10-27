-- Clients chosen as titular of an obra or invited to it (migration 023) exist
-- as a user row, so presupuestos and invitaciones can point at them, but they
-- are not registered until they sign in for the first time (registered_at,
-- set with the first session: invitation link, password or Google/Microsoft).
-- The admin list shows them as «Pendiente de registro».
--
-- access_held: a password registration that claimed one of those rows. Typing
-- an email proves nothing, so that account sees no obra while its email stays
-- unverified (the invitation link or a Google/Microsoft login proves it).
ALTER TABLE users ADD COLUMN registered_at timestamptz;
ALTER TABLE users ADD COLUMN access_held boolean NOT NULL DEFAULT false;

-- Whoever already has a way in, has been in, or is staff counts as registered.
UPDATE users u SET registered_at = u.created_at
 WHERE u.role <> 'client' OR u.password_hash IS NOT NULL OR u.email_verified
    OR EXISTS (SELECT 1 FROM auth_identities i WHERE i.user_id = u.id)
    OR EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id);
