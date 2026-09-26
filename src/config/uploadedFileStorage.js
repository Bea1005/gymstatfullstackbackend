const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const mongoose = require('mongoose');

const GRIDFS_BUCKET_NAME = 'gymstatUploadedFiles';
const GRIDFS_REFERENCE_PREFIX = 'gridfs://';
const LEGACY_UPLOAD_ROOT = path.resolve(
  process.env.LEGACY_UPLOADS_DIR || path.resolve(__dirname, '../../uploads/requirements')
);

const getBucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
  bucketName: GRIDFS_BUCKET_NAME,
});

const toGridFsReference = (fileId) => `${GRIDFS_REFERENCE_PREFIX}${String(fileId)}`;

const getGridFsId = (reference) => {
  if (typeof reference !== 'string' || !reference.startsWith(GRIDFS_REFERENCE_PREFIX)) return null;
  const id = reference.slice(GRIDFS_REFERENCE_PREFIX.length);
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
};

const storeUploadedFile = ({ buffer, stream, filename, contentType, metadata = {} }) => new Promise((resolve, reject) => {
  const source = Buffer.isBuffer(buffer) ? Readable.from(buffer) : stream;
  if (!source || typeof source.pipe !== 'function') {
    reject(new TypeError('Uploaded file data is required.'));
    return;
  }

  const safeFilename = path.basename(String(filename || 'upload'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 180) || 'upload';
  const uploadStream = getBucket().openUploadStream(safeFilename, {
    contentType: contentType || 'application/octet-stream',
    metadata: {
      purpose: String(metadata.purpose || 'gymstat-upload'),
    },
  });

  uploadStream.once('error', reject);
  source.once('error', reject);
  uploadStream.once('finish', () => resolve({
    id: uploadStream.id,
    reference: toGridFsReference(uploadStream.id),
    filename: safeFilename,
  }));
  source.pipe(uploadStream);
});

const deleteStoredUpload = async (reference) => {
  const fileId = getGridFsId(reference);
  if (!fileId) return false;

  try {
    await getBucket().delete(fileId);
    return true;
  } catch (error) {
    if (error.code === 26 || error.code === 'ENOENT' || /FileNotFound/i.test(error.message || '')) return false;
    throw error;
  }
};

const resolveLegacyUploadPath = (reference, fallbackFilename = '') => {
  if (typeof reference !== 'string' || !reference || getGridFsId(reference)) return '';

  const candidates = [
    path.isAbsolute(reference)
      ? path.resolve(reference)
      : path.resolve(LEGACY_UPLOAD_ROOT, path.basename(reference)),
  ];
  if (fallbackFilename) {
    candidates.push(path.resolve(LEGACY_UPLOAD_ROOT, path.basename(fallbackFilename)));
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync(LEGACY_UPLOAD_ROOT);
  } catch {
    return '';
  }

  for (const candidate of new Set(candidates)) {
    const relative = path.relative(LEGACY_UPLOAD_ROOT, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(candidate)) continue;

    try {
      const realCandidate = fs.realpathSync(candidate);
      const realRelative = path.relative(realRoot, realCandidate);
      if (realRelative && !realRelative.startsWith('..') && !path.isAbsolute(realRelative)) return realCandidate;
    } catch {
      continue;
    }
  }

  return '';
};

const streamUploadFile = async (reference, response, {
  filename,
  contentType = 'application/octet-stream',
  disposition = 'attachment',
  fallbackFilename = '',
} = {}) => {
  const fileId = getGridFsId(reference);
  let stream;
  let storedFile;

  if (fileId) {
    storedFile = await getBucket().find({ _id: fileId }).next();
    if (!storedFile) return false;
    stream = getBucket().openDownloadStream(fileId);
    contentType = storedFile.contentType || contentType;
    response.setHeader('Content-Length', String(storedFile.length));
  } else {
    const legacyPath = resolveLegacyUploadPath(reference, fallbackFilename);
    if (!legacyPath) return false;
    stream = fs.createReadStream(legacyPath);
  }

  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'private, no-store');
  if (disposition === 'attachment' && typeof response.attachment === 'function') {
    response.attachment(filename || storedFile?.filename || fallbackFilename || 'download');
  }

  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once('end', () => resolve(true));
    stream.pipe(response);
  });
};

const removeLegacyPathFromResponse = (value, insideFile = false) => {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value) || value._bsontype) return value;
  if (Array.isArray(value)) return value.map((item) => removeLegacyPathFromResponse(item, insideFile));
  if (typeof value.toObject === 'function') {
    return removeLegacyPathFromResponse(value.toObject(), insideFile);
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (insideFile && key === 'path' && typeof item === 'string' && item && !getGridFsId(item)) {
      return [key, ''];
    }
    return [key, removeLegacyPathFromResponse(item, key === 'file')];
  }));
};

module.exports = {
  GRIDFS_BUCKET_NAME,
  GRIDFS_REFERENCE_PREFIX,
  toGridFsReference,
  getGridFsId,
  storeUploadedFile,
  deleteStoredUpload,
  resolveLegacyUploadPath,
  streamUploadFile,
  removeLegacyPathFromResponse,
};