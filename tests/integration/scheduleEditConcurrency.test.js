const assert = require('assert');
const dns = require('dns');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Schedule = require('../../src/models/Schedule');
const { updateSchedule } = require('../../src/controllers/scheduleController');
const { findScheduleConflict } = require('../../src/utils/scheduleConflicts');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const runMongoIntegration = process.env.RUN_SCHEDULE_MONGO_TESTS === 'true';
const describeMongo = runMongoIntegration ? describe : describe.skip;

const callUpdateSchedule = async (id, body) => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };

  await updateSchedule({ params: { id: String(id) }, body }, response);
  return response;
};

describeMongo('schedule edit MongoDB concurrency integration', () => {
  let scheduleIds = [];
  let mongoUri;

  beforeAll(async () => {
    mongoUri = process.env.SCHEDULE_TEST_MONGO_URI || process.env.MONGO_URI;
    if (!mongoUri) throw new Error('A dedicated MongoDB test URI is required.');

    const databaseName = decodeURIComponent(new URL(mongoUri).pathname.slice(1));
    if (databaseName !== 'test') {
      throw new Error('Schedule MongoDB integration tests only run against database "test".');
    }

    const dnsServers = String(process.env.MONGO_DNS_SERVERS || '')
      .split(',')
      .map((server) => server.trim())
      .filter(Boolean);
    if (dnsServers.length) dns.setServers(dnsServers);

    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  }, 30000);

  afterAll(async () => {
    if (scheduleIds.length) {
      await Schedule.deleteMany({ _id: { $in: scheduleIds } });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }, 30000);

  it('serializes real schedule edits and leaves no overlapping active bookings', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const makeCandidate = (date, startTime, endTime) => ({
      startDate: date,
      endDate: date,
      startTime,
      endTime,
      prepDays: 0,
      status: 'active'
    });

    const findUnusedDate = async (year, ranges) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
        const day = String(1 + Math.floor(Math.random() * 27)).padStart(2, '0');
        const date = `${year}-${month}-${day}`;
        const conflicts = await Promise.all(ranges.map(([start, end]) => (
          findScheduleConflict(Schedule, makeCandidate(date, start, end))
        )));

        if (conflicts.every((conflict) => !conflict)) return date;
      }

      throw new Error('Unable to find an unused future date for schedule integration tests.');
    };

    const dateA = await findUnusedDate(2097, [
      ['8:00 AM', '10:00 AM'],
      ['10:00 AM', '12:00 PM']
    ]);
    const dateB = await findUnusedDate(2098, [
      ['8:00 AM', '9:00 AM'],
      ['10:00 AM', '11:00 AM'],
      ['1:00 PM', '2:00 PM']
    ]);

    const schedules = await Schedule.create([
      { ...makeCandidate(dateA, '8:00 AM', '10:00 AM'), event: `edit-a-${suffix}` },
      { ...makeCandidate(dateA, '10:00 AM', '12:00 PM'), event: `edit-b-${suffix}` },
      { ...makeCandidate(dateB, '8:00 AM', '9:00 AM'), event: `edit-c-${suffix}` },
      { ...makeCandidate(dateB, '10:00 AM', '11:00 AM'), event: `edit-d-${suffix}` }
    ]);
    scheduleIds = schedules.map((schedule) => schedule._id);
    const [scheduleA, , scheduleC, scheduleD] = schedules;

    const allowed = await callUpdateSchedule(scheduleA._id, {
      startTime: '8:00 AM',
      endTime: '9:00 AM'
    });
    assert.strictEqual(allowed.statusCode, 200, 'non-overlapping edit should be allowed');

    const rejected = await callUpdateSchedule(scheduleA._id, {
      startTime: '9:00 AM',
      endTime: '11:00 AM'
    });
    assert.strictEqual(rejected.statusCode, 409, 'overlapping edit should be rejected');
    const unchangedSchedule = await Schedule.findById(scheduleA._id).lean();
    assert.strictEqual(unchangedSchedule.endTime, '9:00 AM', 'rejected edit must preserve the original record');

    const selfExcluded = await callUpdateSchedule(scheduleA._id, {
      startTime: '8:00 AM',
      endTime: '10:00 AM'
    });
    assert.strictEqual(selfExcluded.statusCode, 200, 'schedule must not conflict with itself');

    const concurrentResults = await Promise.all([
      callUpdateSchedule(scheduleC._id, { startTime: '1:00 PM', endTime: '2:00 PM' }),
      callUpdateSchedule(scheduleD._id, { startTime: '1:00 PM', endTime: '2:00 PM' })
    ]);
    assert.deepStrictEqual(
      concurrentResults.map((result) => result.statusCode).sort(),
      [200, 409],
      'exactly one of two simultaneous edits into the same slot may succeed'
    );

    const persistedWinners = await Schedule.find({
      status: 'active',
      startDate: dateB,
      endDate: dateB,
      startTime: '1:00 PM',
      endTime: '2:00 PM'
    }).lean();
    assert.strictEqual(persistedWinners.length, 1, 'database must contain only one active booking in the contested slot');

    const remainingConflict = await findScheduleConflict(
      Schedule,
      makeCandidate(dateB, '1:00 PM', '2:00 PM')
    );
    assert(remainingConflict, 'database conflict query must find the persisted winner');
  }, 120000);
});