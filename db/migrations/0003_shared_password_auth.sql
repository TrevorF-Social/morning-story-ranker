-- Pivot to shared-password auth (mirrors the converter apps' pattern).
--
-- Drops the magic-link auth scaffolding:
--   - magic_link_tokens (single-use email tokens)
--   - allowed_emails    (per-user allowlist)
--
-- And relaxes feedback.user_email to nullable so feedback rows can be stamped
-- with NULL (or a constant) when there's no per-user identity. The column is
-- kept so we can re-enable per-user attribution later without a schema break.

drop table if exists magic_link_tokens;
drop table if exists allowed_emails;

alter table feedback alter column user_email drop not null;
