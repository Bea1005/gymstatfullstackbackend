const CALENDAR_TIME_ZONE = 'Asia/Manila';

const getCalendarParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CALENDAR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
};

const parseScheduleTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  if (!match) return null;

  const hour = Number(match[1]);
  if (hour < 1 || hour > 12) return null;
  return (hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(match[2]);
};

const getPastScheduleError = (schedule, now = new Date()) => {
  const { year, month, day, hour, minute, second } = getCalendarParts(now);
  const today = `${year}-${month}-${day}`;
  const startDate = String(schedule?.startDate || '');
  const endDate = String(schedule?.endDate || '');

  if ((startDate && startDate < today) || (endDate && endDate < today)) {
    return 'Past dates cannot be scheduled.';
  }

  const nowMs = (
    Number(hour) * 60 * 60
    + Number(minute) * 60
    + Number(second)
  ) * 1000 + now.getMilliseconds();
  const startMinutes = parseScheduleTime(schedule?.startTime);
  const endMinutes = parseScheduleTime(schedule?.endTime);

  if (startDate === today && startMinutes !== null && startMinutes * 60 * 1000 < nowMs) {
    return 'Past times cannot be scheduled.';
  }
  if (endDate === today && endMinutes !== null && endMinutes * 60 * 1000 < nowMs) {
    return 'Past times cannot be scheduled.';
  }
  return null;
};

module.exports = { getPastScheduleError };
