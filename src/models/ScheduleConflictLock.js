const mongoose = require('mongoose');

const scheduleConflictLockSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'schedule-conflict-lock'
  },
  owner: {
    type: String,
    required: true
  },
  lockedUntil: {
    type: Date,
    required: true
  }
}, {
  collection: 'scheduleconflictlocks'
});

module.exports = mongoose.models.ScheduleConflictLock
  || mongoose.model('ScheduleConflictLock', scheduleConflictLockSchema);