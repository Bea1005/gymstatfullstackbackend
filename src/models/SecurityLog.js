const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  level: {
    type: String,
    enum: ['INFO', 'WARN', 'SECURITY'],
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    maxlength: 80
  },
  userId: {
    type: String,
    default: ''
  },
  role: {
    type: String,
    default: ''
  },
  identifier: {
    type: String,
    default: '',
    maxlength: 120
  },
  resource: {
    type: String,
    default: '',
    maxlength: 240
  },
  ipAddress: {
    type: String,
    default: '',
    maxlength: 64
  },
  result: {
    type: String,
    enum: ['SUCCESS', 'FAILURE'],
    required: true
  },
  reason: {
    type: String,
    default: '',
    maxlength: 160
  }
}, {
  versionKey: false
});

securityLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('SecurityLog', securityLogSchema);
