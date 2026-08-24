const mongoose = require('mongoose');

const AnnouncementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  date: {
    type: Date,
    default: Date.now
  },
  time: {
    type: String,
    default: 'All Day'
  },
  type: {
    type: String,
    enum: ['training', 'requirement', 'general', 'event'],
    default: 'general'
  },
  sport: {
    type: String,
    default: 'General'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // optional link to a Requirement document
  relatedRequirementId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Requirement',
    required: false,
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
AnnouncementSchema.index({ date: -1 });
AnnouncementSchema.index({ sport: 1 });

module.exports = mongoose.model('Announcement', AnnouncementSchema);
