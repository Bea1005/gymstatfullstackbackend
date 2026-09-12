const mongoose = require('mongoose');

const StrasucFacultyMemberSchema = new mongoose.Schema({
  facultyId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  coachId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  role: { type: String, default: 'OTHER FACULTY' },
  name: { type: String, required: true, trim: true },
  age: { type: String, default: '' },
  contactNumber: { type: String, default: '' },
  email: { type: String, default: '' },
  imageFileId: { type: mongoose.Schema.Types.ObjectId, default: null },
  imageFilename: { type: String, default: '' },
  imageMimeType: { type: String, default: '' },
  storageReference: { type: String, default: '' },
}, {
  collection: 'strasucfacultymembers',
  timestamps: true,
});

module.exports = mongoose.models.StrasucFacultyMember
  || mongoose.model('StrasucFacultyMember', StrasucFacultyMemberSchema);