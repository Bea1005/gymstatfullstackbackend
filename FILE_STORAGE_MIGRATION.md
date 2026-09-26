# Uploaded File Storage Migration

## New uploads

Schedule Request attachments and Admin Requirement files are stored in the `gymstatUploadedFiles` GridFS bucket in the existing MongoDB database selected by `MONGO_URI`. Existing MongoDB records keep their metadata; the file key is stored in `ScheduleRequest.file.storageKey` or `Requirement.file.path` as `gridfs://<ObjectId>`. Authentication and existing download route authorization are unchanged.

New uploads do not depend on a Render filesystem mount. The MongoDB service and credentials are already configured through `MONGO_URI`; no public file URLs or new storage credentials are required. Do not remove the MongoDB database or its GridFS collections during deployment.

## Migrating existing local files

Legacy disk-backed records remain readable from the configured `LEGACY_UPLOADS_DIR` (defaulting to the old `backend/uploads/requirements` location for compatibility). To migrate them:

1. Back up the MongoDB database and confirm the old files are accessible from the running backend host. If the old Render filesystem was ephemeral and its files are already gone, those files cannot be reconstructed from MongoDB metadata alone.
2. From `backend/`, run `node scripts/migrateUploadsToGridFS.js` for a read-only dry run. It reports counts only and makes no changes.
3. Review the database name and dry-run counts. Then run `UPLOADS_MIGRATION_CONFIRM_DB=<exact-database-name> node scripts/migrateUploadsToGridFS.js --apply` using the intended environment. The confirmation must exactly match the database name in `MONGO_URI`.
4. The script writes each GridFS object before conditionally updating the existing record's file key. It leaves legacy files in place. If a record changes during the migration, the new GridFS object is deleted and that record is reported as skipped.
5. Verify migrated records through the existing authenticated download endpoints before retiring any old disk copy.

## Render release verification

The repository does not include Render service or persistent-disk configuration, so it cannot prove that a disk is mounted or that a deployed restart/redeploy preserved local files. New GridFS uploads are independent of that disk, but the migration requires the legacy files to be accessible until copied.

Before release, deploy the GridFS-capable code, run the migration against the configured production database after backup, then verify both Schedule Request attachment and Admin Requirement upload/download. Restart and redeploy the Render service and download both files again. Also verify an unauthorized request is rejected and a deleted/missing GridFS file returns 404. Do not declare the release gate complete until the production restart/redeploy check has succeeded.
