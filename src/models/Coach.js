const mongoose = require('mongoose');

const CoachSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  fullname: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true
  },
  email: {
    type: String,
    default: ''
  },
  department: {
    type: String,
    default: ''
  },
  sport: {
    type: String,
    default: ''
  },
  id: {
    type: String,
    required: true
  },
  role: {
    type: String,
    default: 'coach'
  },
  status: {
    type: String,
    default: 'Inactive'
  },
  lastActiveAt: {
    type: Date,
    default: null
  },
  coachPosition: {
    type: String,
    default: ''
  },
  staffMembers: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  assignedSports: {
    type: [String],
    default: []
  },
  sportParticipation: {
    type: [
      {
        role: { type: String, default: '' },
        level: { type: String, default: '' },
        years: { type: String, default: '' }
      }
    ],
    default: []
  }
}, {
  timestamps: true
});

CoachSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Coach', CoachSchema, 'coaches');
