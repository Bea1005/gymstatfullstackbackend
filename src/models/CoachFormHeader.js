const mongoose = require('mongoose');
const defaults = require('../config/coachRecordDefaults').formHeader;

const CoachFormHeaderSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'global',
  },
  olympicsTitle: {
    type: String,
    required: true,
    default: defaults.olympicsTitle,
    maxlength: 5000,
  },
  scheduleLocationLine: {
    type: String,
    required: true,
    default: defaults.scheduleLocationLine,
    maxlength: 5000,
  },
  institution: {
    type: String,
    required: true,
    default: defaults.institution,
    maxlength: 5000,
  },
}, {
  timestamps: true,
  collection: 'coachformheaders',
});

module.exports = mongoose.models.CoachFormHeader
  || mongoose.model('CoachFormHeader', CoachFormHeaderSchema);
