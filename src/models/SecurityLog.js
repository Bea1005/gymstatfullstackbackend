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
  actorName: {
    type: String,
    default: '',
    maxlength: 120
  },
  role: {
    type: String,
    default: ''
  },
  module: {
    type: String,
    default: '',
    maxlength: 80,
    index: true
  },
  description: {
    type: String,
    default: '',
    maxlength: 240
  },
  affectedRecord: {
    type: String,
    default: '',
    maxlength: 160
  },
  changedFields: {
    type: [String],
    default: []
  },
  httpStatus: {
    type: Number,
    default: null
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
securityLogSchema.index({ role: 1, timestamp: -1 });
securityLogSchema.index({ action: 1, timestamp: -1 });
securityLogSchema.index({ module: 1, timestamp: -1 });
securityLogSchema.index({ result: 1, timestamp: -1 });

module.exports = mongoose.model('SecurityLog', securityLogSchema);
