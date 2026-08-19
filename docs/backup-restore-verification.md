# Backup and Restore Verification

Decisionate must verify a restore, not merely report that a provider claims to
have backups. This runbook is intentionally provider-neutral because the
application can run with SQLite during development and with managed
PostgreSQL plus remote object storage in production.

## Database restore

1. Take a provider snapshot using the configured database provider.
2. Restore it into a separate, access-controlled staging database. Never test
   restoration by overwriting the live database.
3. Run the verifier from `apps/api`:

```bash
.venv/bin/python scripts/verify_backup_restore.py \
  --database-url "$RESTORED_DATABASE_URL" \
  --json
```

For a SQLite backup file:

```bash
.venv/bin/python scripts/verify_backup_restore.py \
  --sqlite-backup /secure/staging/decisionate-restored.db \
  --json
```

The command opens the target read-only for SQLite, checks database integrity,
checks foreign-key violations where supported, confirms the core workspace,
dataset, decision, and identity tables exist, and reports counts without
printing records or secrets. A restore is not verified unless the command
returns exit code `0` and `verified: true`.

## Object-storage restore

Database restoration alone is not enough when dataset files live in R2 or S3.

1. Restore a provider snapshot or versioned object copy into an isolated
   staging bucket or prefix.
2. Point a staging API deployment at that prefix and the restored database.
3. Load one representative dataset, one historical partition, and one joined
   dataset through the normal dataset and dashboard paths.
4. Confirm the restored files cannot be read with credentials from another
   workspace and that the application returns the expected row/column
   metadata.
5. Record the snapshot ID, restore target, verification timestamp, sample
   dataset IDs, result, and operator. Delete the staging resources after the
   test according to the provider retention policy.

## Minimum release evidence

Before a production release, retain an internal record containing:

- database snapshot ID and restore duration;
- object-storage snapshot/version and restore duration;
- verifier output and exit code;
- representative application read results;
- any missing files, permission errors, or data discrepancies;
- the next scheduled restore drill.

The application cannot create or restore Railway, R2, S3, or other provider
snapshots by itself. Provider credentials, snapshot schedules, retention,
encryption, and access logs therefore remain deployment responsibilities.
