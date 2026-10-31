const mongoose = require('mongoose');

const pendingRegistrationSchema = new mongoose.Schema({
  fullname: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  emailNormalized: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    sparse: true
  },
  contactNumber: {
    type: String,
    default: '',
    trim: true
  },
  verificationMethod: {
    type: String,
    enum: ['email', 'sms'],
    default: 'email'
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['student', 'coach', 'admin', 'screener'],
    default: 'student'
  },
  department: {
    type: String,
    default: ''
  },
  yearLevel: {
    type: String,
    enum: ['', 'I', 'II', 'III', 'IV'],
    default: ''
  },
  sport: {
    type: String,
    default: ''
  },
  sports: {
    type: [String],
    default: []
  },
  id: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  registrationOtpHash: {
    type: String,
    default: null,
    select: false
  },
  registrationOtpExpiresAt: {
    type: Date,
    default: null,
    select: false
  },
  registrationOtpAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  registrationOtpLastSentAt: {
    type: Date,
    default: null,
    select: false
  },
  registrationOtpResendCount: {
    type: Number,
    default: 0,
    select: false
  },
  contactOtpHash: {
    type: String,
    default: null,
    select: false
  },
  contactOtpExpiresAt: {
    type: Date,
    default: null,
    select: false
  },
  contactOtpAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  contactOtpLastSentAt: {
    type: Date,
    default: null,
    select: false
  },
  contactOtpResendCount: {
    type: Number,
    default: 0,
    select: false
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }
  }
}, {
  timestamps: true
});

pendingRegistrationSchema.index({ emailNormalized: 1 }, { unique: true, sparse: true });
pendingRegistrationSchema.index({ id: 1 }, { unique: true, sparse: true });
pendingRegistrationSchema.index(
  { contactNumber: 1 },
  { unique: true, partialFilterExpression: { contactNumber: { $type: 'string', $gt: '' } } }
);

module.exports = mongoose.model('PendingRegistration', pendingRegistrationSchema, 'pending_registrations');
