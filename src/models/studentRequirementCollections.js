const StudentRequirement = require('./StudentRequirement');

const normalizeParticipationType = (value) => value === 'STRASUC' ? 'STRASUC' : 'Intrams';

const getStudentRequirementModel = (participationType) => (
  normalizeParticipationType(participationType) === 'STRASUC'
    ? require('./StudentRequirementStrasuc')
    : StudentRequirement
);

const getAllStudentRequirementModels = () => [StudentRequirement, require('./StudentRequirementStrasuc')];

module.exports = {
  normalizeParticipationType,
  getStudentRequirementModel,
  getAllStudentRequirementModels
};