const crypto = require('crypto');
const ScheduleConflictLock = require('../models/ScheduleConflictLock');

const LOCK_ID = 'schedule-conflict-lock';
const LOCK_LEASE_MS = 30 * 1000;
const LOCK_WAIT_MS = 5 * 1000;
const LOCK_RETRY_MS = 25;

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const acquireScheduleConflictLock = async () => {
  const owner = crypto.randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + LOCK_LEASE_MS);
    try {
      const lock = await ScheduleConflictLock.findOneAndUpdate(
        {
          _id: LOCK_ID,
          $or: [
            { lockedUntil: { $lte: now } },
            { lockedUntil: { $exists: false } },
          ],
        },
        { $set: { owner, lockedUntil } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();

      if (lock?.owner === owner) {
        return async () => {
          await ScheduleConflictLock.updateOne(
            { _id: LOCK_ID, owner },
            { $set: { lockedUntil: new Date(0) } }
          );
        };
      }
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }

    await wait(LOCK_RETRY_MS);
  }

  const error = new Error('Schedule conflict lock is busy. Please try again.');
  error.statusCode = 503;
  throw error;
};

module.exports = { acquireScheduleConflictLock };