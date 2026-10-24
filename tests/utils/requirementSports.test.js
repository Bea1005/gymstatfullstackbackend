const {
  isRequirementAssignedToStudent,
  splitRequirementSports
} = require('../../src/utils/requirementSports');

describe('requirement sport and event eligibility', () => {
  it('allows an all-scope requirement for students without saved sport or event data', () => {
    expect(isRequirementAssignedToStudent(
      { targetStudents: 'all', sport: 'General' },
      {}
    )).toBe(true);
  });

  it('matches any exact selected sport or event against multiple saved registrations', () => {
    expect(isRequirementAssignedToStudent(
      { targetStudents: 'sport-specific', sport: 'Volleyball (Women) | Essay Writing' },
      { sports: ['Basketball Men', 'Essay Writing'] }
    )).toBe(true);
  });

  it('normalizes equivalent punctuation without matching partial or unrelated labels', () => {
    expect(isRequirementAssignedToStudent(
      { targetStudents: 'sport-specific', sport: 'Basketball (Women)' },
      { sport: 'Basketball Women' }
    )).toBe(true);
    expect(isRequirementAssignedToStudent(
      { targetStudents: 'sport-specific', sport: 'Basketball (Men)' },
      { sports: ['Basketball 3x3 (M/W)'] }
    )).toBe(false);
  });

  it('does not match specific requirements when student registration data is missing', () => {
    expect(isRequirementAssignedToStudent(
      { targetStudents: 'sport-specific', sport: 'Piano' },
      {}
    )).toBe(false);
  });

  it('continues parsing legacy single-sport values and the current delimited scope', () => {
    expect(splitRequirementSports('Volleyball (Women)')).toEqual(['Volleyball (Women)']);
    expect(splitRequirementSports('Volleyball (Women) | Piano')).toEqual([
      'Volleyball (Women)',
      'Piano'
    ]);
  });
});
