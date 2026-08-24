const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  event: {
    type: String,
    required: true,
    trim: true
  },
  startDate: {
    type: String,
    required: true
  },
  endDate: {
    type: String,
    required: true
  },
  startTime: {
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
  status: {
    type: String,
    enum: ['active', 'cancelled', 'completed'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  fromRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ScheduleRequest'
  }
}, {
  timestamps: true
});

// Indexes for better query performance
scheduleSchema.index({ startDate: 1, endDate: 1 });
scheduleSchema.index({ status: 1 });
scheduleSchema.index({ event: 'text' });

const Schedule = mongoose.model('Schedule', scheduleSchema);

module.exports = Schedule;