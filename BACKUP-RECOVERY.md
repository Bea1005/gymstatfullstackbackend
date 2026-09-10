# MongoDB Backup and Recovery

Use MongoDB Atlas scheduled backups for the production cluster. Keep the backup retention period aligned with the project's operational policy and verify that restore access is limited to authorized administrators.

For an operator-managed backup, run `mongodump` against the existing `MONGO_URI` without committing the URI or credentials to source control:

```powershell
mongodump --uri="$env:MONGO_URI" --out=".\backups\gymstat-$(Get-Date -Format yyyyMMdd-HHmmss)"
```

To restore a verified backup during recovery, stop application writes first, then run:

```powershell
mongorestore --uri="$env:MONGO_URI" --drop ".\backups\gymstat-YYYYMMDD-HHMMSS"
```

After restoring, verify the health endpoint, authentication, schedules, equipment inventory, borrowing records, and requirement submissions before reopening the system. Never store backup folders, database URIs, passwords, or exported user data in Git.