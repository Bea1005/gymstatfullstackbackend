const mongoose = require('mongoose');

const scheduleRequestSchema = new mongoose.Schema({
  eventName: {
    type: String,
    required: true,
    trim: true
  },
  requesterName: {
    type: String,
    required: true,
    trim: true
  },
  requesterEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  requesterPhone: {
    type: String,
    required: true,
    trim: true
  },
  organization: {
    type: String,
    trim: true,
    default: ''
  },
  purpose: {
    type: String,
    trim: true,
    default: ''
  },
  details: {
    type: String,
    trim: true,
    default: ''
  },
  startDate: {
    type: String,
    required: true
  },
  startTime: {
    type: String,
    required: true
  },
  endDate: {
    type: String,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  prepDays: {
    type: Number,
    default: 0,
    min: 0
  },
  file: {
    filename: String,
    originalname: String,
    mimetype: String,
    size: Number,
    path: String,
    data: String  // Base64 encoded file data if storing in DB
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  reviewedAt: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionReason: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for better query performance
scheduleRequestSchema.index({ status: 1, createdAt: 1 });
scheduleRequestSchema.index({ requesterEmail: 1 });
scheduleRequestSchema.index({ startDate: 1 });
scheduleRequestSchema.index({ eventName: 'text' });

const ScheduleRequest = mongoose.model('ScheduleRequest', scheduleRequestSchema);

module.exports = ScheduleRequest;