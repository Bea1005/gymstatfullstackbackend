const mongoose = require('mongoose');

// Stores pending screener authorization tokens.
// One active token per screener user -- replaced on resend.
const screenerAuthorizationSchema = new mongoose.Schema({
  screenerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // SHA-256 hash of the raw token -- raw token is only in the email link
  tokenHash: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  confirmedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

// TTL index: MongoDB auto-deletes expired, unconfirmed records after expiresAt
screenerAuthorizationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ScreenerAuthorization', screenerAuthorizationSchema, 'screener_authorizations');
