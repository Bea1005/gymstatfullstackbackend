const mongoose = require('mongoose');
const StudentRequirementSchema = require('./StudentRequirement').schema;

module.exports = mongoose.models.StudentRequirementStrasuc
  || mongoose.model('StudentRequirementStrasuc', StudentRequirementSchema, 'studentrequiremnts-strasuc');