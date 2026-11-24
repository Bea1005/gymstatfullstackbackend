const User = require('../models/User');
const ScreenerIdSequence = require('../models/ScreenerIdSequence');

const MAX_SCREENER_SEQUENCE = 0xFFFF;

class ScreenerIdSequenceExhaustedError extends Error {
  constructor(year) {
    super(`The Screener ID sequence for ${year} is exhausted.`);
    this.name = 'ScreenerIdSequenceExhaustedError';
    this.code = 'SCREENER_ID_SEQUENCE_EXHAUSTED';
  }
}

const currentYear = () => String(new Date().getFullYear());

const getHighestExistingSequence = async (year) => {
  const pattern = new RegExp(`^S${year}-[0-9A-F]{4}$`, 'i');
  const screenersQuery = User.find({
    role: 'screener',
    id: { $regex: pattern }
  }).select('id');
  const screeners = await screenersQuery.lean();

  return (Array.isArray(screeners) ? screeners : []).reduce((highest, screener) => {
    const match = new RegExp(`^S${year}-([0-9A-F]{4})$`, 'i')
      .exec(String(screener?.id || ''));
    const sequence = match ? Number.parseInt(match[1], 16) : 0;
    return Number.isInteger(sequence) ? Math.max(highest, sequence) : highest;
  }, 0);
};

const readSequence = async (year) => {
  const query = ScreenerIdSequence.findById(year);
  return query && typeof query.lean === 'function' ? query.lean() : query;
};

const ensureSequence = async (year) => {
  if (await readSequence(year)) return;

  const value = await getHighestExistingSequence(year);
  try {
    await ScreenerIdSequence.updateOne(
      { _id: year },
      { $setOnInsert: { value } },
      { upsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
};

const formatScreenerId = (year, sequence) => (
  `S${year}-${sequence.toString(16).toUpperCase().padStart(4, '0')}`
);

const allocateNextScreenerId = async () => {
  const year = currentYear();
  await ensureSequence(year);

  const query = ScreenerIdSequence.findOneAndUpdate(
    { _id: year, value: { $lt: MAX_SCREENER_SEQUENCE } },
    { $inc: { value: 1 } },
    { new: true }
  );
  const sequence = query && typeof query.lean === 'function' ? await query.lean() : await query;
  if (!sequence || !Number.isInteger(sequence.value)) {
    throw new ScreenerIdSequenceExhaustedError(year);
  }

  return formatScreenerId(year, sequence.value);
};

const getNextScreenerId = async () => {
  const year = currentYear();
  const sequence = await readSequence(year);
  const highestExisting = await getHighestExistingSequence(year);
  const nextValue = Math.max(Number(sequence?.value) || 0, highestExisting) + 1;
  if (nextValue > MAX_SCREENER_SEQUENCE) {
    throw new ScreenerIdSequenceExhaustedError(year);
  }

  return formatScreenerId(year, nextValue);
};

module.exports = {
  allocateNextScreenerId,
  getNextScreenerId,
  MAX_SCREENER_SEQUENCE,
  ScreenerIdSequenceExhaustedError
};
