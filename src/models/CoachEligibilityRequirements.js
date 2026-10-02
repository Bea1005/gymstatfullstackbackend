const mongoose = require('mongoose');
const defaults = require('../config/coachRecordDefaults').eligibility;

const CoachEligibilityRequirementsSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'global',
  },
  requirementsNotes: {
    type: String,
    required: true,
    default: defaults.requirementsNotes,
    maxlength: 5000,
  },
}, {
  timestamps: true,
  collection: 'coacheligibilityrequirements',
});

module.exports = mongoose.models.CoachEligibilityRequirements
  || mongoose.model('CoachEligibilityRequirements', CoachEligibilityRequirementsSchema);
