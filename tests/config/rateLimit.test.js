const express = require('express');
const request = require('supertest');
const { getCoachApiRateLimitKey } = require('../../src/config/rateLimit');

describe('Coach API rate-limit keys', () => {
  it('uses the mounted Coach route family rather than the individual student ID', async () => {
    const app = express();
    app.use('/api/v1', (req, res) => {
      req.user = { _id: 'coach-id' };
      return res.json({ key: getCoachApiRateLimitKey(req) });
    });

    const firstStudent = await request(app).get('/api/v1/coach/athletes/student-one');
    const secondStudent = await request(app).get('/api/v1/coach/athletes/student-two');
    const recordContent = await request(app).get('/api/v1/coach/record-content');

    expect(firstStudent.body.key).toBe('coach:user:coach-id:GET:coach:athletes');
    expect(secondStudent.body.key).toBe(firstStudent.body.key);
    expect(recordContent.body.key).toBe('coach:user:coach-id:GET:coach:record-content');
    expect(recordContent.body.key).not.toBe(firstStudent.body.key);
  });
});
