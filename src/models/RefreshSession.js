const mongoose = require('mongoose');

const refreshSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    select: false,
  },
  familyId: {
    type: String,
    required: true,
    index: true,
  },
  replacedByTokenHash: {
    type: String,
    default: null,
    select: false,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  revokedAt: {
    type: Date,
    default: null,
    index: true,
  },
}, {
  timestamps: true,
});

refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshSessionSchema.index({ userId: 1, revokedAt: 1 });

module.exports = mongoose.model('RefreshSession', refreshSessionSchema);
