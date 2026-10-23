-- Whether this user's email has actually been proven to belong to them.
-- A password alone never proves this (email verification was explicitly out
-- of scope for #10), so a password-only account starts unverified. A social
-- login (Google/Microsoft/Apple) proves it the moment it's used, and only an
-- already-verified account may ever be linked to by a new login method —
-- see the fix note in src/auth/identities.js for why this column exists.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
