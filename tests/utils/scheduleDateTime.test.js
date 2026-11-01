const { getPastScheduleError } = require('../../src/utils/scheduleDateTime');

describe('schedule date/time validation', () => {
  const now = new Date('2026-11-01T06:23:27.000Z');

  it('rejects dates before the current calendar date in Manila', () => {
    expect(getPastScheduleError({
      startDate: '2026-10-31',
      endDate: '2026-11-02',
      startTime: '3:00 PM',
      endTime: '4:00 PM',
    }, now)).toBe('Past dates cannot be scheduled.');
  });

  it('rejects times earlier than the current time on today', () => {
    expect(getPastScheduleError({
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      startTime: '2:00 PM',
      endTime: '3:00 PM',
    }, now)).toBe('Past times cannot be scheduled.');
  });

  it('allows the current minute and future times on today', () => {
    expect(getPastScheduleError({
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      startTime: '2:24 PM',
      endTime: '3:00 PM',
    }, now)).toBeNull();
  });

  it('allows valid future dates without restricting their time values', () => {
    expect(getPastScheduleError({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      startTime: '8:00 AM',
      endTime: '10:00 AM',
    }, now)).toBeNull();
  });
});
