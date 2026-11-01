const TIME_ZONE = 'Asia/Manila';

const getManilaDateTimeParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
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

const parseBorrowingDate = (value) => {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    ? null
    : date;
};

const parseBorrowingTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  if (!match) return null;

  const hour = Number(match[1]);
  if (hour < 1 || hour > 12) return null;
  return (hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(match[2]);
};

const formatManilaTime = ({ hour, minute }) => {
  const hourNumber = Number(hour);
  const hour12 = hourNumber % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${minute} ${hourNumber >= 12 ? 'PM' : 'AM'}`;
};

const validateBorrowingDateTime = (dateValue, timeValue, now = new Date()) => {
  const date = parseBorrowingDate(dateValue);
  if (!date) return { error: 'Select a valid borrowing date.' };

  const timeMinutes = parseBorrowingTime(timeValue);
  if (timeMinutes === null) return { error: 'Select a valid borrowing time.' };

  const nowParts = getManilaDateTimeParts(now);
  const today = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
  if (date < today) return { error: 'Past borrowing dates are not allowed.' };

  if (date === today) {
    const nowSeconds = Number(nowParts.hour) * 3600
      + Number(nowParts.minute) * 60
      + Number(nowParts.second)
      + now.getMilliseconds() / 1000;
    if (timeMinutes * 60 < nowSeconds) {
      return { error: 'Past borrowing times are not allowed.' };
    }
  }

  const [year, month, day] = date.split('-').map(Number);
  const hour24 = Math.floor(timeMinutes / 60);
  const minute = timeMinutes % 60;
  return {
    error: '',
    date,
    time: String(timeValue).trim(),
    borrowDate: new Date(Date.UTC(year, month - 1, day, hour24 - 8, minute)),
  };
};

const getCurrentManilaBorrowingDateTime = (now = new Date()) => {
  const parts = getManilaDateTimeParts(now);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: formatManilaTime(parts),
    borrowDate: new Date(now),
  };
};

module.exports = {
  getCurrentManilaBorrowingDateTime,
  validateBorrowingDateTime,
};
