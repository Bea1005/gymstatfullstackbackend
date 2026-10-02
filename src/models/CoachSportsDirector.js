const mongoose = require('mongoose');
const defaults = require('../config/coachRecordDefaults').director;

const CoachSportsDirectorSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'global',
  },
  eventLabel: {
    type: String,
    required: true,
    default: defaults.eventLabel,
    maxlength: 5000,
  },
  directorName: {
    type: String,
    required: true,
    default: defaults.directorName,
    maxlength: 5000,
  },
  directorTitle: {
    type: String,
    required: true,
    default: defaults.directorTitle,
    maxlength: 5000,
  },
}, {
  timestamps: true,
  collection: 'coachsportsdirectors',
});

module.exports = mongoose.models.CoachSportsDirector
  || mongoose.model('CoachSportsDirector', CoachSportsDirectorSchema);
