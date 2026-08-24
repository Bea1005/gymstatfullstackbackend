const mongoose = require('mongoose');

const ScreenerSchema = new mongoose.Schema({
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
    default: 'screener'
  },
  status: {
    type: String,
    default: 'Inactive'
  },
  lastActiveAt: {
    type: Date,
    default: null
  },
  screenerLevel: {
    type: String,
    default: ''
  },
  assignedSports: {
    type: [String],
    default: []
  }
}, {
  timestamps: true
});

ScreenerSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Screener', ScreenerSchema, 'screeners');
