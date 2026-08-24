const mongoose = require('mongoose');

const StudentAthleteSchema = new mongoose.Schema({
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
  contactNumber: {
    type: String,
    default: ''
  },
  dob: {
    type: String,
    default: ''
  },
  dateOfBirth: {
    type: String,
    default: ''
  },
  profilePhoto: {
    type: String,
    default: ''
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
  branchCampus: {
    type: String,
    enum: ['', 'Boac Main', 'Santa Cruz', 'Gasan', 'Torrijos'],
    default: ''
  },
  id: {
    type: String,
    required: true
  },
  role: {
    type: String,
    default: 'student'
  },
  status: {
    type: String,
    default: 'Inactive'
  },
  lastActiveAt: {
    type: Date,
    default: null
  },
  studentNumber: {
    type: String,
    default: ''
  },
  graduationYear: {
    type: String,
    default: ''
  },
  athleteStatus: {
    type: String,
    default: ''
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

StudentAthleteSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('StudentAthlete', StudentAthleteSchema, 'studentathletes');
