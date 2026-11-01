const {
  getCurrentManilaBorrowingDateTime,
  validateBorrowingDateTime,
} = require('../../src/utils/borrowingDateTime');

describe('borrowing date and time validation in Manila', () => {
  const noonManila = new Date('2026-11-01T04:00:00.000Z');

  test('rejects a date before the current Manila date', () => {
    expect(validateBorrowingDateTime('2026-10-31', '09:00 AM', noonManila).error)
      .toBe('Past borrowing dates are not allowed.');
  });

  test('rejects an elapsed time on the current Manila date', () => {
    expect(validateBorrowingDateTime('2026-11-01', '11:30 AM', noonManila).error)
      .toBe('Past borrowing times are not allowed.');
  });

  test('allows the current minute and future dates', () => {
    expect(validateBorrowingDateTime('2026-11-01', '12:00 PM', noonManila).error).toBe('');
    expect(validateBorrowingDateTime('2026-11-02', '07:00 AM', noonManila).error).toBe('');
  });

  test('interprets the selected Manila time consistently when creating the date value', () => {
    const result = validateBorrowingDateTime('2026-11-02', '07:30 AM', noonManila);

    expect(result.borrowDate.toISOString()).toBe('2026-11-01T23:30:00.000Z');
    expect(result.date).toBe('2026-11-02');
    expect(result.time).toBe('07:30 AM');
  });

  test('rejects invalid calendar dates and malformed times', () => {
    expect(validateBorrowingDateTime('2026-02-30', '09:00 AM', noonManila).error)
      .toBe('Select a valid borrowing date.');
    expect(validateBorrowingDateTime('2026-11-02', '25:00 PM', noonManila).error)
      .toBe('Select a valid borrowing time.');
  });

  test('defaults a legacy request without a date or time to the current Manila timestamp', () => {
    expect(getCurrentManilaBorrowingDateTime(noonManila)).toEqual({
      date: '2026-11-01',
      time: '12:00 PM',
      borrowDate: noonManila,
    });
  });
});
