const { getScheduleClientType } = require('../../src/utils/scheduleClientType');

describe('getScheduleClientType', () => {
  it('classifies marsu.edu.ph email addresses as internal despite case and surrounding spaces', () => {
    expect(getScheduleClientType('  Requester@MARSU.EDU.PH  ')).toBe('Internal Client');
  });

  it('classifies other email domains as external', () => {
    expect(getScheduleClientType('requester@gmail.com')).toBe('External Client');
    expect(getScheduleClientType('requester@other.edu.ph')).toBe('External Client');
  });

  it('leaves records without a usable email domain unclassified', () => {
    expect(getScheduleClientType(null)).toBeNull();
    expect(getScheduleClientType('not-an-email')).toBeNull();
    expect(getScheduleClientType('requester@')).toBeNull();
  });
});
