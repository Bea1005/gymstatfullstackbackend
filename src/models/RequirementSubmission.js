const mongoose = require('mongoose');

const RequirementSubmissionSchema = new mongoose.Schema({
  requirementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Requirement',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  file: {
    filename: String,
    originalname: String,
    mimetype: String,
    size: Number,
    path: String,
    url: String
  },
  status: {
    type: String,
    enum: ['submitted', 'under-review', 'approved', 'rejected', 'revision-needed'],
    default: 'submitted'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  feedback: {
    type: String,
    trim: true,
    default: ''
  },
  remarks: {
    type: String,
    trim: true,
    default: ''
  },
  grade: {
    type: String,
    default: ''
  },
  isLate: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
RequirementSubmissionSchema.index({ requirementId: 1, studentId: 1 }, { unique: true });
RequirementSubmissionSchema.index({ studentId: 1, status: 1 });
RequirementSubmissionSchema.index({ status: 1, submittedAt: -1 });
RequirementSubmissionSchema.index({ requirementId: 1, status: 1 });

// Virtual to check if submission exists
RequirementSubmissionSchema.virtual('requirement', {
  ref: 'Requirement',
  localField: 'requirementId',
  foreignField: '_id',
  justOne: true
});

RequirementSubmissionSchema.virtual('student', {
  ref: 'User',
  localField: 'studentId',
  foreignField: '_id',
  justOne: true
});

module.exports = mongoose.model('RequirementSubmission', RequirementSubmissionSchema);
