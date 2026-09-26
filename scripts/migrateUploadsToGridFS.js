const dns = require('dns');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const Requirement = require('../src/models/Requirement');
const ScheduleRequest = require('../src/models/ScheduleRequest');
const {
  getGridFsId,
  resolveLegacyUploadPath,
  storeUploadedFile,
  deleteStoredUpload,
} = require('../src/config/uploadedFileStorage');

const getMongoDatabaseName = (uri) => decodeURIComponent(new URL(uri).pathname.slice(1));

const migrateRecords = async ({ model, purpose, referencePath, dryRun, counts }) => {
  const records = await model.find({ file: { $exists: true, $ne: null } })
    .select('_id file')
    .lean();

  for (const record of records) {
    const file = record.file || {};
    const existingReference = referencePath === 'file.storageKey'
      ? (file.storageKey || file.path || file.filename)
      : (file.path || file.filename);

    if (getGridFsId(existingReference)) {
      counts.alreadyPersistent += 1;
      continue;
    }

    const legacyPath = resolveLegacyUploadPath(existingReference, file.filename);
    if (!legacyPath) {
      counts.missing += 1;
      continue;
    }

    if (dryRun) {
      counts.wouldMigrate += 1;
      continue;
    }

    const uploaded = await storeUploadedFile({
      stream: fs.createReadStream(legacyPath),
      filename: file.originalname || file.filename,
      contentType: file.mimetype || 'application/octet-stream',
      metadata: { purpose, sourceRecordId: String(record._id) },
    });

    const previousValue = referencePath === 'file.storageKey'
      ? file.storageKey
      : file.path;
    const compareFilter = previousValue === undefined
      ? { [referencePath]: { $exists: false } }
      : { [referencePath]: previousValue };
    const result = await model.updateOne(
      { _id: record._id, ...compareFilter },
      { $set: { [referencePath]: uploaded.reference } }
    );

    if (result.modifiedCount === 1) {
      counts.migrated += 1;
    } else {
      await deleteStoredUpload(uploaded.reference);
      counts.changedDuringMigration += 1;
    }
  }
};

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI must be configured.');

  const databaseName = getMongoDatabaseName(uri);
  const dryRun = !process.argv.includes('--apply');
  if (!dryRun && process.env.UPLOADS_MIGRATION_CONFIRM_DB !== databaseName) {
    throw new Error('Set UPLOADS_MIGRATION_CONFIRM_DB to the exact database name before applying migration.');
  }

  const dnsServers = String(process.env.MONGO_DNS_SERVERS || '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.length) dns.setServers(dnsServers);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  const counts = {
    wouldMigrate: 0,
    migrated: 0,
    alreadyPersistent: 0,
    missing: 0,
    changedDuringMigration: 0,
  };

  try {
    await migrateRecords({
      model: ScheduleRequest,
      purpose: 'schedule-request-attachment',
      referencePath: 'file.storageKey',
      dryRun,
      counts,
    });
    await migrateRecords({
      model: Requirement,
      purpose: 'admin-requirement',
      referencePath: 'file.path',
      dryRun,
      counts,
    });

    console.log(JSON.stringify({ database: databaseName, mode: dryRun ? 'dry-run' : 'apply', ...counts }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('Upload migration failed:', error.message);
  process.exitCode = 1;
});
