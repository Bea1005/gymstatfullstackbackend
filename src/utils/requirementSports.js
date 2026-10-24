const SPORT_SCOPE_SEPARATOR = '|';

const normalizeSportLabel = (sport) => String(sport || '')
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .toLowerCase();

const splitRequirementSports = (sport) => String(sport || '')
  .split(SPORT_SCOPE_SEPARATOR)
  .map((label) => label.trim())
  .filter(Boolean);

const getStudentSports = (user = {}) => [
  user.sport,
  ...(Array.isArray(user.sports) ? user.sports : []),
  ...(Array.isArray(user.assignedSports) ? user.assignedSports : []),
  ...(Array.isArray(user.sportParticipation)
    ? user.sportParticipation.map((participation) => participation?.sport)
    : [])
].filter(Boolean);

const isRequirementAssignedToStudent = (requirement, user) => {
  if (requirement.targetStudents !== 'sport-specific') return true;

  const studentSports = new Set(getStudentSports(user).map(normalizeSportLabel));
  return splitRequirementSports(requirement.sport)
    .some((sport) => studentSports.has(normalizeSportLabel(sport)));
};

module.exports = {
  getStudentSports,
  isRequirementAssignedToStudent,
  splitRequirementSports
};
