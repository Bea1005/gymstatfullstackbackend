// models/Requirement.js
const mongoose = require('mongoose');

const RequirementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  type: {
    type: String,
    enum: ['medical', 'cor', 'psa', 'insurance', 'profile', 'consent', 'other'],
    required: true
  },
  sport: {
    type: String,
    default: 'General'
  },
  dueDate: {
    type: Date,
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  file: {
    filename: String,
    originalname: String,
    mimetype: String,
    size: Number,
    path: String  // Store the file path on disk
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },
  publishedAt: {
    type: Date
  },
  publishedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  targetStudents: {
    type: String,
    enum: ['all', 'sport-specific'],
    default: 'all'
  },
  instructions: {
    type: String,
    trim: true,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  viewCount: {
    type: Number,
    default: 0
  },
  submissionCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
RequirementSchema.index({ status: 1, publishedAt: -1 });
RequirementSchema.index({ sport: 1, status: 1 });
RequirementSchema.index({ dueDate: 1 });
RequirementSchema.index({ type: 1 });
RequirementSchema.index({ title: 'text', description: 'text' });

// Virtual for checking if requirement is overdue
RequirementSchema.virtual('isOverdue').get(function() {
  return this.dueDate < new Date() && this.status === 'published';
});

// Method to mark as published
RequirementSchema.methods.publish = function(publisherId) {
  this.status = 'published';
  this.publishedAt = new Date();
  this.publishedBy = publisherId;
  return this.save();
};

// Method to increment view count
RequirementSchema.methods.incrementViewCount = function() {
  this.viewCount += 1;
  return this.save();
};

// Method to increment submission count
RequirementSchema.methods.incrementSubmissionCount = function() {
  this.submissionCount += 1;
  return this.save();
};

module.exports = mongoose.model('Requirement', RequirementSchema);