const mongoose = require('mongoose');

const StudentProfileSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  imageFileId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  filename: {
    type: String,
    required: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  storageReference: {
    type: String,
    required: true,
  },
}, {
  collection: 'studentprofile',
  timestamps: true,
});

module.exports = mongoose.models.StudentProfile || mongoose.model('StudentProfile', StudentProfileSchema);