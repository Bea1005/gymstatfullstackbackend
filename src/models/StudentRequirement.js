const mongoose = require('mongoose');

const StudentRequirementSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requirementType: {
    type: String,
    enum: ['medical', 'cor', 'psa', 'insurance', 'profile', 'consent', 'other', 'tor'],
    required: true
  },
  participationType: {
    type: String,
    enum: ['Intrams', 'STRASUC'],
    default: 'Intrams'
  },
  customRequirementId: {
    type: String,
    default: ''
  },
  customRequirementLabel: {
    type: String,
    default: ''
  },
  fileName: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requirementStatus: {
    type: String,
    enum: ['active', 'expired', 'archived', 'reusable'],
    default: 'active'
  },
  academicYear: {
    type: String,
    default: ''
  },
  previousAcademicYear: {
    type: String,
    default: ''
  },
  importedFromPreviousYear: {
    type: Boolean,
    default: false
  },
  isReusable: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    default: null
  },
  archivedAt: {
    type: Date,
    default: null
  },
  archivedReason: {
    type: String,
    default: ''
  },
  sourceRequirementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudentRequirement',
    default: null
  },
  remarks: {
    type: String,
    default: ''
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  approvalDate: {
    type: Date,
    default: null
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sport: {
    type: String,
    default: 'General'
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  resubmitted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for efficient queries
StudentRequirementSchema.index({ studentId: 1, status: 1 });
StudentRequirementSchema.index({ studentId: 1, requirementType: 1, academicYear: 1, requirementStatus: 1 });
StudentRequirementSchema.index({ uploadDate: -1 });
StudentRequirementSchema.index({ resubmitted: 1 });

module.exports = mongoose.model('StudentRequirement', StudentRequirementSchema);
