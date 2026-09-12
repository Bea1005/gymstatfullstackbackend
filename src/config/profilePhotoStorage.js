const { Readable } = require('stream');
const mongoose = require('mongoose');

const GRIDFS_BUCKET_NAME = 'studentProfilePhotos';

const getBucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
  bucketName: GRIDFS_BUCKET_NAME,
});

const uploadProfilePhoto = ({ buffer, filename, contentType, studentId, purpose = 'student-profile-photo' }) => new Promise((resolve, reject) => {
  const uploadStream = getBucket().openUploadStream(filename, {
    contentType,
    metadata: { studentId: String(studentId), purpose },
  });

  uploadStream.once('error', reject);
  uploadStream.once('finish', () => resolve(uploadStream.id));
  Readable.from(buffer).pipe(uploadStream);
});

const deleteProfilePhoto = async (fileId) => {
  if (!fileId) return;
  try {
    await getBucket().delete(new mongoose.Types.ObjectId(fileId));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 26 && !/FileNotFound/i.test(error.message || '')) throw error;
  }
};

const streamProfilePhoto = (fileId, response) => new Promise((resolve, reject) => {
  const downloadStream = getBucket().openDownloadStream(new mongoose.Types.ObjectId(fileId));
  downloadStream.once('error', reject);
  downloadStream.once('end', resolve);
  downloadStream.pipe(response);
});

module.exports = {
  GRIDFS_BUCKET_NAME,
  uploadProfilePhoto,
  deleteProfilePhoto,
  streamProfilePhoto,
};