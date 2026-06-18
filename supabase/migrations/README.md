# Supabase migrations

Schema for the `aired-platform` Supabase project. Migrations are applied to the
live project through the Supabase tooling (dashboard / MCP) and recorded in
`supabase_migrations.schema_migrations`. The `.sql` files here are the
authoritative, reviewable record of the DDL/DML that was applied — each filename
is `<version>_<name>.sql`, matching its `schema_migrations` row exactly.

History before `2026-06-18` (the Phase 0–4 build) predates in-repo tracking and
lives only in the project's `schema_migrations` table; files here begin at the
Artist-via-Profile foundation change. Each file is written to be run once, in
filename order, with RLS enabled and an empty `search_path` on functions.
