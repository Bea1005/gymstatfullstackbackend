const toMinutes = (time) => {
  const [clock, meridian] = String(time || '').trim().split(/\s+/);
  const [hours, minutes] = String(clock || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;
  let normalizedHours = hours % 12;
  if (String(meridian).toUpperCase() === 'PM') normalizedHours += 12;
  return normalizedHours * 60 + minutes;
};

const toDateAtMidnight = (value) => new Date(`${value}T00:00:00`);

const getOccupiedRange = (schedule) => {
  const startDate = toDateAtMidnight(schedule.startDate);
  const endDate = toDateAtMidnight(schedule.endDate);
  const prepDays = Math.max(0, Number(schedule.prepDays || 0) || 0);
  const occupiedStartDate = new Date(startDate);
  occupiedStartDate.setDate(occupiedStartDate.getDate() - prepDays);
  const startMinutes = toMinutes(schedule.startTime);
  const endMinutes = toMinutes(schedule.endTime);

  return {
    start: occupiedStartDate.getTime() + startMinutes * 60000,
    end: endDate.getTime() + endMinutes * 60000,
  };
};

const schedulesOverlap = (candidate, existing) => {
  const candidateRange = getOccupiedRange(candidate);
  const existingRange = getOccupiedRange(existing);
  if (![candidateRange.start, candidateRange.end, existingRange.start, existingRange.end]
    .every(Number.isFinite)) return false;

  return candidateRange.start < existingRange.end
    && candidateRange.end > existingRange.start;
};

const findScheduleConflict = async (Schedule, candidate) => {
  const schedules = await Schedule.find({ status: 'active' }).lean();

  return schedules.find((schedule) => schedulesOverlap(candidate, schedule)) || null;
};

module.exports = {
  findScheduleConflict,
  schedulesOverlap,
};