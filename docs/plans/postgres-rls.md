# Fail-closed PostgreSQL guild isolation (#19 / #14)

Scope: shared-schema PostgreSQL only; no production migration or new dependency.
Preserve the participant/public contracts and use the server-owned installed-guild
inventory, never client guild IDs or stale OAuth snapshots, for discovery.

- [x] Inventory current tables and inherited policies; trace request, Discord,
  maintenance, member lifecycle, Kysely and restore callers.
- [x] Observe real non-bypass app-role participant/public handler failures.
- [x] Bind participant request lifecycles after fresh membership and scoped event
  discovery; query My hackathons separately in every freshly permitted guild.
- [x] Scope public published projections, scheduler, lifecycle and restore work.
- [x] Prove every policy, no-context read/write refusal, pool reuse/rollback/nesting,
  concurrent leases, role/grants/no-DDL, repeat migration and recovery.
- [x] Document inventory, pooling, grants and enumerated maintenance exceptions.
- [ ] Run baseline, commit candidate, advisory gates, PR and exact-head CI.
- [ ] Same-card independent QA, then planner-owned delivery.
