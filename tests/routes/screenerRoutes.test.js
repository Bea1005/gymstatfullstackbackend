const httpMocks = require('node-mocks-http');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const StudentRequirement = require('../../src/models/StudentRequirement');
const StudentRequirementStrasuc = require('../../src/models/StudentRequirementStrasuc');
const User = require('../../src/models/User');
const StudentAthlete = require('../../src/models/StudentAthlete');
const { protect, authorize } = require('../../src/middleware/auth');
const screenerRoutes = require('../../src/routes/screenerRoutes');

jest.mock('../../src/models/StudentRequirement');
jest.mock('../../src/models/StudentRequirementStrasuc', () => ({
  find: jest.fn()
}));
jest.mock('../../src/models/User');
jest.mock('../../src/models/StudentAthlete');
jest.mock('../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  authorize: jest.fn(() => (req, res, next) => next())
}));

const makeCoachApprovedRequirements = (studentId, sport, participationType = 'Intrams') => (
  ['medical', 'psa', 'insurance', 'profile', 'consent'].map((requirementType, index) => ({
    _id: `${studentId}-${requirementType}`,
    studentId,
    requirementType,
    participationType,
    sport,
    fileName: `${requirementType}.pdf`,
    fileType: 'application/pdf',
    fileSize: 64,
    requirementStatus: 'active',
    status: 'pending',
    coachStatus: 'approved',
    uploadDate: new Date(`2026-10-0${index + 1}T00:00:00.000Z`)
  }))
);

describe('Screener routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = {
        _id: 'screener-1',
        role: req.get('x-test-role') || 'admin',
        department: req.get('x-test-no-department') === 'true'
          ? ''
          : req.get('x-test-department') || 'CICS'
      };
      next();
    });
    app.use('/api/v1', screenerRoutes);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  it('lists only submitted students matching the coach sports and event assignments', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-matched'],
      sport: 'Basketball Women',
      assignedSports: ['Basketball Women', 'Softball'],
      assignedEvents: ['Intrams']
    }));
    User.find.mockReturnValue(makeQuery([
      {
        _id: 'student-matched',
        id: 'STU-001',
        fullname: 'Matched Student',
        sport: 'Basketball Women',
        sports: ['Basketball Women', 'Softball'],
        department: 'Engineering'
      },
    ]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery([
      {
        _id: 'submission-matched',
        studentId: 'student-matched',
        requirementType: 'cor',
        participationType: 'Intrams',
        sport: 'Basketball Women',
        fileName: 'registration.pdf',
        fileType: 'application/pdf',
        fileSize: 64,
        requirementStatus: 'active',
        files: [
          { fileName: 'front.jpg', fileType: 'image/jpeg', fileSize: 30 },
          { fileName: 'back.jpg', fileType: 'image/jpeg', fileSize: 34 }
        ],
        status: 'pending'
      },
      {
        _id: 'submission-other-event',
        studentId: 'student-matched',
        requirementType: 'psa',
        participationType: 'STRASUC',
        sport: 'Softball',
        fileName: 'psa.pdf',
        fileType: 'application/pdf',
        fileSize: 64,
        requirementStatus: 'active',
        status: 'pending'
      },
      {
        _id: 'submission-not-in-gallery',
        studentId: 'student-not-in-gallery',
        requirementType: 'cor',
        participationType: 'Intrams',
        sport: 'Basketball Women',
        fileName: 'unassigned.pdf',
        fileType: 'application/pdf',
        fileSize: 64,
        requirementStatus: 'active',
        status: 'pending'
      }
    ]));

    const response = await request(app)
      .get('/api/v1/coach/requirements')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 'student-matched',
      name: 'Matched Student',
      sports: ['Basketball Women']
    }));
    expect(response.body.selectedSport).toBe('Basketball Women');
    expect(response.body.data[0].requirements.documents).toHaveLength(1);
    expect(response.body.data[0].requirements.documents[0].files).toHaveLength(2);
    expect(response.body.data[0].requirements.documents[0].fileUrl).toContain('/coach/requirements/');
    expect(response.body.forwardingStatus.canForward).toBe(false);
    expect(StudentRequirement.find).toHaveBeenCalledTimes(1);
    expect(StudentRequirement.find).toHaveBeenCalledWith(expect.objectContaining({
      $and: expect.arrayContaining([
        { requirementStatus: 'active' },
        { studentId: { $in: ['student-matched'] } }
      ])
    }));
    expect(User.find).toHaveBeenCalledWith({
      role: 'student',
      _id: { $in: ['student-matched'] }
    });
  });

  it('filters coach roster and readiness to the selected sport', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const basketballSubmissions = makeCoachApprovedRequirements('student-basketball', 'Basketball Women');
    const volleyballSubmissions = makeCoachApprovedRequirements('student-volleyball', 'Volleyball')
      .map((submission) => ({ ...submission, coachStatus: 'pending' }));
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      sport: 'Basketball Women',
      strasucStudentIds: ['student-basketball', 'student-volleyball'],
      assignedSports: ['Basketball Women', 'Volleyball'],
      assignedEvents: ['Intrams']
    }));
    User.find.mockReturnValue(makeQuery([
      { _id: 'student-basketball', fullname: 'Basketball Student', sports: ['Basketball Women'] },
      { _id: 'student-volleyball', fullname: 'Volleyball Student', sports: ['Volleyball'] }
    ]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery([...basketballSubmissions, ...volleyballSubmissions]));

    const response = await request(app)
      .get('/api/v1/coach/requirements?sport=Basketball%20Women')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.data.map((student) => student.id)).toEqual(['student-basketball']);
    expect(response.body.assignedSports).toEqual(['Basketball Women', 'Volleyball']);
    expect(response.body.forwardingStatus.canForward).toBe(true);
  });

  it('uses the same linked Student Athlete sport profile as the Coach Gallery roster', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-gallery'],
      assignedSports: ['Basketball Women'],
      assignedEvents: ['Intrams']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-gallery',
      id: 'STU-100',
      fullname: 'Gallery Student',
      sport: '',
      sports: []
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([{
      id: 'STU-100',
      sports: ['Basketball Women'],
      yearLevel: 'II'
    }]));
    StudentRequirement.find.mockReturnValue(makeQuery([{
      _id: 'gallery-submission',
      studentId: 'student-gallery',
      requirementType: 'cor',
      participationType: 'Intrams',
      sport: 'Basketball Women',
      fileName: 'registration.pdf',
      fileType: 'application/pdf',
      fileSize: 64,
      requirementStatus: 'active',
      status: 'pending'
    }]));

    const response = await request(app)
      .get('/api/v1/coach/requirements?sport=Basketball%20Women')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.data.map((student) => student.id)).toEqual(['student-gallery']);
    expect(response.body.data[0].sport).toBe('Basketball Women');
    expect(StudentAthlete.find).toHaveBeenCalledWith({
      $or: expect.arrayContaining([{ id: { $in: ['STU-100'] } }])
    });
  });

  it('does not allow the coach screening API to switch away from the primary assigned sport', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      sport: 'Basketball Women',
      assignedSports: ['Basketball Women', 'Volleyball']
    }));

    const response = await request(app)
      .get('/api/v1/coach/requirements?sport=Volleyball')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('not assigned');
    expect(User.find).not.toHaveBeenCalled();
  });

  it('groups a student assigned to multiple sports and events without duplicate entries', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-multiple'],
      sport: 'Basketball Women',
      assignedSports: ['Basketball Women', 'Softball'],
      assignedEvents: ['Intrams', 'STRASUC']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-multiple',
      id: 'STU-003',
      fullname: 'Multi-sport Student',
      sports: ['Basketball Women', 'Softball'],
      department: 'Engineering'
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery([{
      _id: 'intrams-submission',
      studentId: 'student-multiple',
      requirementType: 'cor',
      participationType: 'Intrams',
      sport: 'Basketball Women',
      fileName: 'intrams.pdf',
      fileType: 'application/pdf',
      fileSize: 10,
      requirementStatus: 'active',
      status: 'pending'
    }]));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([{
      _id: 'strasuc-submission',
      studentId: 'student-multiple',
      requirementType: 'psa',
      participationType: 'STRASUC',
      sport: 'Softball',
      fileName: 'strasuc.pdf',
      fileType: 'application/pdf',
      fileSize: 12,
      requirementStatus: 'active',
      status: 'pending'
    }]));

    const response = await request(app)
      .get('/api/v1/coach/requirements')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].requirements.documents.map((entry) => entry.participationType))
      .toEqual(['Intrams']);
    expect(response.body.selectedSport).toBe('Basketball Women');
    expect(StudentRequirementStrasuc.find).toHaveBeenCalledTimes(1);
  });

  it('uses the latest active submission for readiness and ignores older duplicate records', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissions = makeCoachApprovedRequirements('student-complete', 'Basketball');
    submissions.unshift({
      ...submissions[0],
      _id: 'student-complete-old-medical',
      coachStatus: 'rejected',
      uploadDate: new Date('2026-09-30T00:00:00.000Z')
    });
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-complete'],
      assignedSports: ['Basketball'],
      assignedEvents: ['Intrams', 'STRASUC']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-complete',
      role: 'student',
      fullname: 'Complete Student',
      sports: ['Basketball']
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery(submissions));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([]));

    const completeResponse = await request(app)
      .get('/api/v1/coach/requirements')
      .set('x-test-role', 'coach');

    expect(completeResponse.status).toBe(200);
    const coachDocuments = completeResponse.body.data[0].requirements.documents;
    expect(coachDocuments).toHaveLength(6);
    expect(coachDocuments.some((document) => document.status === 'rejected')).toBe(true);
    expect(coachDocuments[0].finalStatus).toBe('pending');
    expect(completeResponse.body.forwardingStatus.canForward).toBe(true);

    submissions[1].coachStatus = 'rejected';
    const incompleteResponse = await request(app)
      .get('/api/v1/coach/requirements')
      .set('x-test-role', 'coach');

    expect(incompleteResponse.status).toBe(200);
    expect(incompleteResponse.body.forwardingStatus.canForward).toBe(false);
  });

  it('allows readiness when the active document is coach-approved regardless of screener status', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissions = makeCoachApprovedRequirements('student-review-needed', 'Basketball')
      .map((submission) => submission.requirementType === 'insurance'
        ? { ...submission, status: 'rejected' }
        : submission);
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-review-needed'],
      assignedSports: ['Basketball'],
      assignedEvents: ['Intrams']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-review-needed',
      role: 'student',
      sports: ['Basketball']
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery(submissions));

    const response = await request(app)
      .get('/api/v1/coach/requirements?sport=Basketball')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.forwardingStatus.canForward).toBe(true);
  });

  it('ignores archived and non-active requirements when calculating forwarding readiness', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const activeSubmissions = makeCoachApprovedRequirements('student-active', 'Basketball');
    const inactiveSubmissions = [
      { ...activeSubmissions[0], _id: 'archived-rejected', requirementStatus: 'archived', coachStatus: 'rejected' },
      { ...activeSubmissions[0], _id: 'reusable-pending', requirementStatus: 'reusable', coachStatus: 'pending' },
      { ...activeSubmissions[0], _id: 'expired-pending', requirementStatus: 'expired', coachStatus: 'pending' },
      { ...activeSubmissions[0], _id: 'missing-status-pending', requirementStatus: undefined, coachStatus: 'pending' }
    ];
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-active'],
      assignedSports: ['Basketball'],
      assignedEvents: ['Intrams', 'STRASUC']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-active',
      role: 'student',
      fullname: 'Active Student',
      sports: ['Basketball']
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery([...activeSubmissions, ...inactiveSubmissions]));

    const response = await request(app)
      .get('/api/v1/coach/requirements')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.data[0].requirements.documents).toHaveLength(activeSubmissions.length);
    expect(response.body.forwardingStatus.canForward).toBe(true);
    expect(StudentRequirement.find).toHaveBeenCalledWith(expect.objectContaining({
      $and: expect.arrayContaining([
        { requirementStatus: 'active' }
      ])
    }));
  });

  it('allows forwarding when all submitted active documents are approved even if some categories are not uploaded', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissions = [
      {
        _id: 'student-sparse-medical',
        studentId: 'student-sparse',
        requirementType: 'medical',
        participationType: 'Intrams',
        sport: 'Basketball',
        requirementStatus: 'active',
        status: 'pending',
        coachStatus: 'approved',
        uploadDate: new Date('2026-10-02T00:00:00.000Z')
      },
      {
        _id: 'student-sparse-psa',
        studentId: 'student-sparse',
        requirementType: 'psa',
        participationType: 'Intrams',
        sport: 'Basketball',
        requirementStatus: 'active',
        status: 'pending',
        coachStatus: 'approved',
        uploadDate: new Date('2026-10-03T00:00:00.000Z')
      }
    ];
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-sparse'],
      assignedSports: ['Basketball'],
      assignedEvents: ['Intrams', 'STRASUC']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-sparse',
      role: 'student',
      fullname: 'Sparse Requirements',
      sports: ['Basketball']
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery(submissions));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([]));

    const response = await request(app)
      .get('/api/v1/coach/requirements')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.forwardingStatus.canForward).toBe(true);
  });

  it('releases complete sport groups together and keeps other sports independent', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const basketballPending = makeCoachApprovedRequirements('basketball-pending', 'Basketball')
      .map((submission) => submission.requirementType === 'consent'
        ? { ...submission, coachStatus: 'pending' }
        : submission);
    const submissions = [
      ...makeCoachApprovedRequirements('basketball-ready', 'Basketball'),
      ...basketballPending,
      ...makeCoachApprovedRequirements('volleyball-ready', 'Volleyball')
    ];
    const students = [
      { _id: 'basketball-ready', fullname: 'Basketball Ready', department: 'Engineering' },
      { _id: 'basketball-pending', fullname: 'Basketball Pending', department: 'Engineering' },
      { _id: 'volleyball-ready', fullname: 'Volleyball Ready', department: 'Engineering' }
    ];
    User.find.mockReturnValue(makeQuery(students));
    StudentAthlete.find.mockReturnValue(makeQuery(students.map((student, index) => ({
      userId: student._id,
      sports: [index === 2 ? 'Volleyball' : 'Basketball']
    }))));
    StudentRequirement.find.mockReturnValue(makeQuery(submissions));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([]));

    const firstResponse = await request(app).get('/api/v1/screener/requirements');

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.data.map((student) => student.id)).toEqual(['volleyball-ready']);
    expect(firstResponse.body.data[0].requirements.documents).toHaveLength(5);

    submissions.find((submission) => submission._id === 'basketball-pending-consent').coachStatus = 'approved';
    const secondResponse = await request(app).get('/api/v1/screener/requirements');

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.data.map((student) => student.id).sort()).toEqual([
      'basketball-pending',
      'basketball-ready',
      'volleyball-ready'
    ]);
  });

  it('denies a coach review when the student sports do not match the coach assignment', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submission = {
      _id: 'submission-track',
      studentId: 'student-track',
      participationType: 'Intrams',
      sport: 'Track and Field',
      status: 'pending',
      save: jest.fn().mockResolvedValue(true)
    };
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      assignedSports: ['Basketball Women']
    }));
    User.findOne.mockReturnValue(makeQuery({
      _id: 'student-track',
      role: 'student',
      sports: ['Track and Field']
    }));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.findById.mockResolvedValue(submission);

    const response = await request(app)
      .put('/api/v1/coach/requirements/submission-track/review')
      .set('x-test-role', 'coach')
      .send({
        status: 'approved',
        studentId: 'student-track',
        participationType: 'Intrams'
      });

    expect(response.status).toBe(403);
    expect(submission.save).not.toHaveBeenCalled();
  });

  it('denies document previews for students outside the coach sports', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissionId = '507f1f77bcf86cd799439011';
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-basketball'],
      assignedSports: ['Basketball Women']
    }));
    User.findOne.mockReturnValue(makeQuery({
      _id: 'student-track',
      role: 'student',
      sports: ['Track and Field']
    }));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.findById.mockReturnValue(makeQuery({
      _id: submissionId,
      studentId: 'student-track',
      participationType: 'Intrams',
      sport: 'Track and Field',
      fileName: 'track.pdf',
      fileType: 'application/pdf',
      fileData: Buffer.from('private')
    }));

    const response = await request(app)
      .get(`/api/v1/coach/requirements/${submissionId}/preview?participationType=Intrams`)
      .set('x-test-role', 'coach');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('not authorized');
  });

  it('approves an assigned student submission in the existing record', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submission = {
      _id: 'submission-basketball',
      studentId: 'student-basketball',
      participationType: 'Intrams',
      sport: 'Basketball Women',
      status: 'pending',
      save: jest.fn().mockResolvedValue(true)
    };
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      strasucStudentIds: ['student-basketball'],
      assignedSports: ['Basketball Women']
    }));
    User.findOne.mockReturnValue(makeQuery({
      _id: 'student-basketball',
      role: 'student',
      sports: ['Basketball Women']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-basketball',
      role: 'student',
      sports: ['Basketball Women']
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.findById.mockResolvedValue(submission);

    const response = await request(app)
      .put('/api/v1/coach/requirements/submission-basketball/review')
      .set('x-test-role', 'coach')
      .send({
        status: 'approved',
        studentId: 'student-basketball',
        participationType: 'Intrams'
      });

    expect(response.status).toBe(200);
    expect(submission.status).toBe('pending');
    expect(submission.coachStatus).toBe('approved');
    expect(submission.coachReviewedBy).toBe('screener-1');
    expect(submission.notificationReadAt).toBeNull();
    expect(submission.approvedBy).toBeUndefined();
    expect(submission.reviewedBy).toBeUndefined();
    expect(submission.save).toHaveBeenCalled();
  });

  it('prevents forwarding while any assigned student requirement is pending coach screening', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissions = makeCoachApprovedRequirements('student-forward', 'Basketball')
      .map((submission) => submission.requirementType === 'consent'
        ? { ...submission, coachStatus: 'pending' }
        : submission);
    User.findById.mockReturnValue(makeQuery({
      _id: 'coach-1',
      role: 'coach',
      strasucStudentIds: ['student-forward'],
      assignedSports: ['Basketball'],
      assignedEvents: ['Intrams', 'STRASUC']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-forward',
      role: 'student',
      sports: ['Basketball']
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    const archivedSubmission = {
      ...submissions[0],
      _id: 'archived-forward-requirement',
      requirementStatus: 'archived',
      coachStatus: 'rejected'
    };
    StudentRequirement.find.mockReturnValue(makeQuery([...submissions, archivedSubmission]));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([]));

    const response = await request(app)
      .post('/api/v1/coach/requirements/forward')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('complete the initial screening');
  });

  it('forwards all approved assigned requirements and records the coach and time', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissions = [
      ...makeCoachApprovedRequirements('student-forward', 'Basketball'),
      {
        ...makeCoachApprovedRequirements('student-forward', 'Basketball')[0],
        _id: 'student-forward-medical-resubmission',
        uploadDate: new Date('2026-10-10T00:00:00.000Z')
      },
      ...makeCoachApprovedRequirements('student-forward-second', 'Basketball')
    ];
    const forwardedSubmissions = submissions.filter((submission) => (
      submission._id !== 'student-forward-medical'
    ));
    const archivedSubmission = {
      ...submissions[0],
      _id: 'archived-forward-requirement',
      requirementStatus: 'archived',
      coachStatus: 'rejected'
    };
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn()
    };
    const originalStartSession = mongoose.startSession;
    mongoose.startSession = jest.fn().mockResolvedValue(session);
    User.findById.mockReturnValue(makeQuery({
      _id: 'coach-1',
      role: 'coach',
      strasucStudentIds: ['student-forward', 'student-forward-second'],
      assignedSports: ['Basketball'],
      assignedEvents: ['Intrams', 'STRASUC']
    }));
    User.find.mockReturnValue(makeQuery([
      {
        _id: 'student-forward',
        role: 'student',
        sports: ['Basketball']
      },
      {
        _id: 'student-forward-second',
        role: 'student',
        sports: ['Basketball']
      }
    ]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery([...submissions, archivedSubmission]));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([]));
    StudentRequirement.updateMany = jest.fn().mockResolvedValue({
      modifiedCount: forwardedSubmissions.length
    });

    const response = await request(app)
      .post('/api/v1/coach/requirements/forward')
      .set('x-test-role', 'coach');

    mongoose.startSession = originalStartSession;
    expect(response.status).toBe(200);
    expect(response.body.forwardedCount).toBe(forwardedSubmissions.length);
    expect(session.withTransaction).toHaveBeenCalled();
    expect(StudentRequirement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: expect.arrayContaining(forwardedSubmissions.map((submission) => submission._id)) },
        coachStatus: 'approved',
        requirementStatus: 'active',
        screenerForwardedAt: null
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          screenerForwardedAt: expect.any(Date),
          screenerForwardedBy: 'coach-1'
        })
      }),
      { session }
    );
    expect(StudentRequirement.updateMany.mock.calls[0][0]._id.$in)
      .not.toContain(archivedSubmission._id);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('automatically forwards the primary assigned sport without waiting for another sport', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const basketballSubmissions = [
      ...makeCoachApprovedRequirements('student-basketball', 'Basketball Women'),
    ];
    const volleyballSubmissions = makeCoachApprovedRequirements('student-volleyball', 'Volleyball')
      .map((submission) => ({ ...submission, coachStatus: 'pending' }));
    const session = {
      withTransaction: jest.fn(async (callback) => callback()),
      endSession: jest.fn()
    };
    const originalStartSession = mongoose.startSession;
    mongoose.startSession = jest.fn().mockResolvedValue(session);
    User.findById.mockReturnValue(makeQuery({
      _id: 'coach-1',
      role: 'coach',
      sport: 'Basketball Women',
      strasucStudentIds: ['student-basketball'],
      assignedSports: ['Basketball Women', 'Volleyball'],
      assignedEvents: ['Intrams', 'STRASUC']
    }));
    User.find.mockReturnValue(makeQuery([
      { _id: 'student-basketball', role: 'student', sports: ['Basketball Women'] }
    ]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery([...basketballSubmissions, ...volleyballSubmissions]));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([]));
    StudentRequirement.updateMany = jest.fn().mockResolvedValue({
      modifiedCount: basketballSubmissions.length
    });

    const response = await request(app)
      .post('/api/v1/coach/requirements/forward')
      .set('x-test-role', 'coach');

    mongoose.startSession = originalStartSession;
    expect(response.status).toBe(200);
    expect(response.body.forwardedCount).toBe(basketballSubmissions.length);
    expect(StudentRequirement.updateMany.mock.calls[0][0]._id.$in)
      .toEqual(basketballSubmissions.map((submission) => submission._id));
    expect(StudentRequirement.updateMany.mock.calls[0][0]._id.$in)
      .not.toContain(volleyballSubmissions[0]._id);
  });

  it('prevents forwarding a group that has already been forwarded', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissions = makeCoachApprovedRequirements('student-forward', 'Basketball')
      .map((submission) => ({ ...submission, screenerForwardedAt: new Date() }));
    User.findById.mockReturnValue(makeQuery({
      _id: 'coach-1',
      role: 'coach',
      strasucStudentIds: ['student-forward'],
      assignedSports: ['Basketball']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-forward',
      role: 'student',
      sports: ['Basketball']
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery(submissions));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([]));

    const response = await request(app)
      .post('/api/v1/coach/requirements/forward')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('already been forwarded');
  });

  it('denies marking a different-department requirement as viewed', async () => {
    const submission = {
      _id: 'other-department-submission',
      studentId: 'student-other',
      resubmitted: true,
      save: jest.fn()
    };
    StudentRequirement.findById.mockResolvedValue(submission);
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: 'Engineering' })
    });

    const response = await request(app)
      .put('/api/v1/screener/requirements/other-department-submission/viewed')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS')
      .send({ participationType: 'Intrams' });

    expect(response.status).toBe(403);
    expect(submission.save).not.toHaveBeenCalled();
  });

  it('retains the submission and saves the rejection reason', async () => {
    const submission = {
      _id: 'submission-1',
      studentId: 'student-1',
      filePath: 'uploads/requirements/rejected.pdf',
      status: 'pending',
      remarks: '',
      save: jest.fn().mockResolvedValue(true)
    };

    StudentRequirement.findById.mockResolvedValue(submission);

    const response = await request(app)
      .put('/api/v1/screener/requirements/submission-1/review')
      .send({ status: 'rejected', studentId: 'student-1', feedback: 'Wrong file', remarks: 'Please re-upload' });

    expect(response.status).toBe(200);
    expect(StudentRequirement.findByIdAndDelete).not.toHaveBeenCalled();
    expect(submission.status).toBe('rejected');
    expect(submission.remarks).toBe('Wrong file — Please re-upload');
    expect(submission.save).toHaveBeenCalled();
    expect(response.body.message).toContain('retained');
  });

  it('rejects deletion when the requirement belongs to another student', async () => {
    StudentRequirement.findById.mockResolvedValue({
      _id: 'submission-3',
      studentId: 'student-1',
      filePath: 'uploads/requirements/other.pdf'
    });

    const response = await request(app)
      .put('/api/v1/screener/requirements/submission-3/review')
      .send({ status: 'rejected', studentId: 'student-2' });

    expect(response.status).toBe(403);
    expect(StudentRequirement.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('marks an existing submission as viewed', async () => {
    const submission = {
      _id: 'submission-2',
      resubmitted: true,
      save: jest.fn().mockResolvedValue(true)
    };

    StudentRequirement.findById.mockResolvedValue(submission);

    const response = await request(app)
      .put('/api/v1/screener/requirements/submission-2/viewed');

    expect(response.status).toBe(200);
    expect(submission.resubmitted).toBe(false);
    expect(submission.save).toHaveBeenCalled();
  });

  it('shows every forwarded document for a department without waiting for unrelated athletes in the sport group', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const forwardedAt = new Date('2026-11-02T00:00:00.000Z');
    const students = [
      {
        _id: 'student-forwarded',
        fullname: 'Forwarded Student',
        department: 'CICS',
        sports: ['Basketball']
      },
      {
        _id: 'student-not-forwarded',
        fullname: 'Other Basketball Student',
        department: 'CICS',
        sports: ['Basketball']
      }
    ];
    const forwardedSubmissions = makeCoachApprovedRequirements('student-forwarded', 'Basketball')
      .map((submission, index) => ({
        ...submission,
        studentId: students[0],
        screenerForwardedAt: forwardedAt,
        screenerForwardedBy: 'coach-1',
        ...(index === 0
          ? {
              files: [
                { fileName: 'medical-front.jpg', fileType: 'image/jpeg', fileSize: 20, filePath: 'front.jpg' },
                { fileName: 'medical-back.jpg', fileType: 'image/jpeg', fileSize: 22, filePath: 'back.jpg' }
              ]
            }
          : {})
      }));
    const unforwardedSubmission = {
      ...forwardedSubmissions[0],
      _id: 'student-forwarded-unforwarded',
      screenerForwardedAt: null
    };
    User.find.mockReturnValue(makeQuery(students));
    StudentAthlete.find.mockReturnValue(makeQuery(students.map((student) => ({
      userId: student._id,
      sports: student.sports
    }))));
    StudentRequirement.find.mockReturnValue(makeQuery([...forwardedSubmissions, unforwardedSubmission]));

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams&sport=Basketball')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.data.map((student) => student.id)).toEqual(['student-forwarded']);
    expect(response.body.data[0].requirements.documents).toHaveLength(forwardedSubmissions.length);
    expect(response.body.data[0].requirements.documents.every((document) => (
      document.screenerForwardedBy === 'coach-1'
    ))).toBe(true);
    const medicalDocument = response.body.data[0].requirements.documents
      .find((document) => document.requirementType === 'medical');
    expect(medicalDocument.files).toHaveLength(2);
    expect(medicalDocument.files[1].fileUrl)
      .toContain('fileIndex=1');
    expect(StudentRequirement.find).toHaveBeenCalledWith(expect.objectContaining({
      $and: expect.arrayContaining([
        { screenerForwardedAt: { $ne: null } },
        { studentId: { $in: ['student-forwarded', 'student-not-forwarded'] } }
      ])
    }));
  });

  it('lists requirements only for students in the screener department', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { _id: 'student-own', fullname: 'Own Department Student', department: 'CICS', yearLevel: 'I' },
        { _id: 'student-other', fullname: 'Other Department Student', department: 'Engineering', yearLevel: ' II ' },
        { _id: 'student-without-year', fullname: 'Student Without Year Level', department: 'Engineering', yearLevel: '' }
      ])
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { userId: 'student-own', yearLevel: 'I', sports: ['Basketball'] },
        { userId: 'student-other', yearLevel: 'II', sports: ['Basketball'] },
        { userId: 'student-without-year', yearLevel: '', sports: [] }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        ...makeCoachApprovedRequirements('student-own', 'Basketball').map((submission) => ({
          ...submission,
          screenerForwardedAt: new Date(),
          screenerForwardedBy: 'coach-1',
          studentId: {
            _id: 'student-own',
            fullname: 'Own Department Student',
            department: 'CICS',
            yearLevel: 'I'
          }
        })),
        {
          _id: 'own-submission',
          studentId: { _id: 'student-own', fullname: 'Own Department Student', department: 'CICS', yearLevel: 'I' },
          requirementType: 'cor',
          sport: 'Basketball',
          fileName: 'own.pdf',
          status: 'pending',
          coachStatus: 'approved',
          screenerForwardedAt: new Date(),
          screenerForwardedBy: 'coach-1',
          fileSize: 3,
          fileData: Buffer.from('own'),
        },
        ...makeCoachApprovedRequirements('student-other', 'Basketball').map((submission) => ({
          ...submission,
          coachStatus: 'pending',
          studentId: {
            _id: 'student-other',
            fullname: 'Other Department Student',
            department: 'Engineering',
            yearLevel: 'II'
          }
        }))
      ])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.assignedDepartment).toBe('CICS');
    const listedStudentIds = response.body.data.map((student) => student.id);
    expect(listedStudentIds).toContain('student-own');
    expect(listedStudentIds).not.toContain('student-other');
    expect(User.find).toHaveBeenCalled();
    expect(StudentRequirement.find).toHaveBeenCalledWith(expect.objectContaining({
      $and: expect.arrayContaining([
        { screenerForwardedAt: { $ne: null } }
      ])
    }));
  });

  it('does not return student records when a screener has no assigned department', async () => {
    const response = await request(app)
      .get('/api/v1/screener/requirements')
      .set('x-test-role', 'screener')
      .set('x-test-no-department', 'true');

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Screener department is not configured.');
    expect(User.find).not.toHaveBeenCalled();
  });

  it('loads Intrams and STRASUC requirements together when no participation filter is provided', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const student = {
      _id: 'student-shared',
      fullname: 'Shared Student',
      department: 'Engineering',
      yearLevel: 'II',
      sports: ['Basketball']
    };
    User.find.mockReturnValue(makeQuery([student]));
    StudentAthlete.find.mockReturnValue(makeQuery([{
      userId: 'student-shared',
      sports: ['Basketball']
    }]));
    StudentRequirement.find.mockReturnValue(makeQuery(
      makeCoachApprovedRequirements('student-shared', 'Basketball')
    ));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([{
      _id: 'strasuc-cor',
      studentId: student,
      requirementType: 'cor',
      sport: 'Basketball',
      participationType: 'STRASUC',
      fileName: 'strasuc.pdf',
      fileSize: 10,
      status: 'pending',
      coachStatus: 'approved',
      requirementStatus: 'active',
      screenerForwardedAt: new Date(),
      screenerForwardedBy: 'coach-1'
    }]));
    StudentRequirement.find.mockReturnValue(makeQuery(
      makeCoachApprovedRequirements('student-shared', 'Basketball')
        .map((submission) => ({
          ...submission,
          screenerForwardedAt: new Date(),
          screenerForwardedBy: 'coach-1'
        }))
    ));

    const response = await request(app)
      .get('/api/v1/screener/requirements')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'Engineering');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].requirements.documents.map((entry) => entry.participationType))
      .toEqual(expect.arrayContaining(['Intrams', 'STRASUC']));
    expect(StudentRequirement.find).toHaveBeenCalledTimes(1);
    expect(StudentRequirementStrasuc.find).toHaveBeenCalledTimes(1);
  });

  it('returns all saved profile sports and links submissions once by student ID', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'student-bea',
          id: 'BEA-001',
          fullname: 'Bea',
          department: 'Engineering',
          yearLevel: 'IV',
          sport: 'USER FIELD SPORT MUST NOT MATCH',
          sports: ['USER FIELD SPORT MUST NOT MATCH']
        }
      ])
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          userId: 'student-bea',
          yearLevel: '2nd Year',
          sport: 'DIFFERENT ATHLETE SPORT FIELD',
          sports: [' WOMEN BASKETBALL ', 'SOFTBALL', '', null, 'softball']
        }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        ...makeCoachApprovedRequirements('student-bea', 'WOMEN BASKETBALL'),
        {
          _id: 'bea-cor-submission',
          studentId: 'student-bea',
          requirementType: 'cor',
          sport: 'WOMEN BASKETBALL',
          fileName: 'bea-cor.pdf',
          fileType: 'application/pdf',
          fileSize: 128,
          files: [
            { fileName: 'front.jpg', fileType: 'image/jpeg', fileSize: 64 },
            { fileName: 'back.jpg', fileType: 'image/jpeg', fileSize: 64 }
          ],
          status: 'pending',
          coachStatus: 'approved',
          uploadDate: '2026-10-08T00:00:00.000Z'
        }
      ])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'admin')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 'student-bea',
      name: 'Bea',
      sport: 'WOMEN BASKETBALL',
      sports: ['WOMEN BASKETBALL'],
      yearLevel: '2nd Year'
    }));
    expect(response.body.data[0].requirements.documents).toHaveLength(6);
    expect(response.body.data[0].requirements.documents.find((entry) => entry.submissionId === 'bea-cor-submission')).toEqual(expect.objectContaining({
      submissionId: 'bea-cor-submission',
      fileName: 'bea-cor.pdf',
      status: 'pending',
      coachStatus: 'approved',
      hasUpload: true,
      files: [
        expect.objectContaining({ fileName: 'front.jpg', fileType: 'image/jpeg', fileUrl: expect.stringContaining('fileIndex=0') }),
        expect.objectContaining({ fileName: 'back.jpg', fileType: 'image/jpeg', fileUrl: expect.stringContaining('fileIndex=1') })
      ]
    }));
    expect(StudentRequirement.find).toHaveBeenCalledWith({
      $and: [
        { $or: [{ participationType: 'Intrams' }, { participationType: { $exists: false } }] },
        { requirementStatus: { $nin: ['archived', 'expired'] } }
      ]
    });
    expect(StudentAthlete.find().select).toHaveBeenCalledWith('userId sport sports assignedSports sportParticipation yearLevel');
  });

  it('uses only the linked Student Athlete sports array and year level', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'student-legacy',
          id: 'LEGACY-001',
          fullname: 'Legacy Student',
          department: 'Engineering',
          yearLevel: 'I',
          sport: 'USER FIELD SPORT',
          sports: ['USER FIELD SPORT']
        }
      ])
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          userId: 'student-legacy',
          yearLevel: 'III',
          sport: 'ATHLETE SINGLE SPORT FIELD',
          sports: ['WOMEN BASKETBALL', 'SOFTBALL']
        }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'admin')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(StudentAthlete.find).toHaveBeenCalledWith({
      userId: { $in: ['student-legacy'] }
    });
  });

  it('does not fall back to the separate sport field when the sports array is empty', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'student-empty-sports',
          fullname: 'Student With Empty Sports',
          department: 'Engineering',
          sport: 'USER SPORT MUST NOT MATCH',
          sports: ['USER SPORT MUST NOT MATCH']
        }
      ])
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          userId: 'student-empty-sports',
          sport: 'ATHLETE SPORT MUST NOT MATCH',
          sports: [],
          yearLevel: 'I'
        }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'admin')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('denies Screener review of a different-department requirement', async () => {
    const submission = {
      _id: 'own-submission',
      studentId: 'student-own',
      coachStatus: 'approved',
      screenerForwardedAt: new Date(),
      save: jest.fn()
    };
    StudentRequirement.findById.mockResolvedValue(submission);
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: 'Engineering' })
    });

    const response = await request(app)
      .put('/api/v1/screener/requirements/own-submission/review')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS')
      .send({ status: 'approved' });

    expect(response.status).toBe(403);
    expect(submission.save).not.toHaveBeenCalled();
  });

  it('allows Screener review of an assigned-department requirement', async () => {
    const submission = {
      _id: 'assigned-submission',
      studentId: 'student-assigned',
      coachStatus: 'approved',
      screenerForwardedAt: new Date(),
      save: jest.fn().mockResolvedValue(true)
    };
    StudentRequirement.findById.mockResolvedValue(submission);
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: '  cics  ' })
    });

    const response = await request(app)
      .put('/api/v1/screener/requirements/assigned-submission/review')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS')
      .send({ status: 'approved', studentId: 'student-assigned' });

    expect(response.status).toBe(200);
    expect(submission.save).toHaveBeenCalled();
  });

  it('previews the stored submission bytes by MongoDB ID with the saved MIME type', async () => {
    const submissionId = '507f1f77bcf86cd799439011';
    const uploadedImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    StudentRequirement.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: submissionId,
        fileName: 'student-profile.png',
        fileType: 'image/png',
        fileData: uploadedImage,
        participationType: 'Intrams',
      }),
    });

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams`);

    expect(response.status).toBe(200);
    expect(StudentRequirement.findById).toHaveBeenCalledWith(submissionId);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body)).toEqual(uploadedImage);
  });

  it('previews the selected photo from a multi-photo requirement submission', async () => {
    const submissionId = '507f1f77bcf86cd799439011';
    const secondPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    StudentRequirement.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: submissionId,
        files: [
          { fileName: 'front.jpg', fileType: 'image/jpeg', fileData: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
          { fileName: 'back.jpg', fileType: 'image/jpeg', fileData: secondPhoto }
        ],
        participationType: 'Intrams',
      }),
    });

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams&fileIndex=1`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body)).toEqual(secondPhoto);
  });

  it('denies Screener preview of a different-department requirement', async () => {
    const submissionId = '507f1f77bcf86cd799439011';
    StudentRequirement.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: submissionId,
        studentId: 'student-own',
        fileName: 'own.pdf',
        fileType: 'application/pdf',
        fileData: Buffer.from('private requirement'),
        coachStatus: 'approved',
        screenerForwardedAt: new Date()
      })
    });
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: 'Engineering' })
    });

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams`)
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('not authorized');
  });

  it('denies a screener preview when the document is outside the selected sport', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissionId = '507f1f77bcf86cd799439011';
    User.findById.mockReturnValue(makeQuery({
      department: 'CICS',
      sports: ['Volleyball']
    }));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.findById.mockReturnValue(makeQuery({
      _id: submissionId,
      studentId: 'student-volleyball',
      sport: 'Volleyball',
      coachStatus: 'approved',
      screenerForwardedAt: new Date(),
      fileName: 'volleyball.pdf',
      fileType: 'application/pdf',
      fileData: Buffer.from('private')
    }));

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams&sport=Basketball`)
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('not authorized');
  });

  it('denies Screener preview of a same-department requirement before forwarding', async () => {
    const submissionId = '507f1f77bcf86cd799439011';
    StudentRequirement.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: submissionId,
        studentId: 'student-assigned',
        fileName: 'assigned.pdf',
        fileType: 'application/pdf',
        fileData: Buffer.from('private requirement'),
        coachStatus: 'approved'
      })
    });
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: 'CICS' })
    });

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams`)
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('has not been forwarded');
  });

  it('previews an assigned-department requirement', async () => {
    const submissionId = '507f1f77bcf86cd799439011';
    const uploadedFile = Buffer.from('%PDF-1.4 assigned');
    StudentRequirement.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: submissionId,
        studentId: 'student-assigned',
        fileName: 'assigned.pdf',
        fileType: 'application/pdf',
        fileData: uploadedFile,
        coachStatus: 'approved',
        screenerForwardedAt: new Date()
      })
    });
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: 'CICS' })
    });

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams`)
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body)).toEqual(uploadedFile);
  });

  it('prevents a screener from reviewing requirements before coach approval', async () => {
    const submission = {
      _id: 'waiting-coach',
      studentId: 'student-outside',
      status: 'pending',
      coachStatus: 'pending',
      save: jest.fn().mockResolvedValue(true)
    };
    StudentRequirement.findById.mockResolvedValue(submission);
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: 'CICS' })
    });

    const response = await request(app)
      .put('/api/v1/screener/requirements/waiting-coach/review')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS')
      .send({
        status: 'approved',
        studentId: 'student-outside',
        participationType: 'Intrams'
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('sport group is approved by the coach');
    expect(submission.save).not.toHaveBeenCalled();
  });

  const approvedRequiredDocuments = () => [
    { _id: 'approved-med', studentId: 'student-1', requirementType: 'medical', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'medical.pdf', fileType: 'application/pdf', fileData: Buffer.from('medical') },
    { _id: 'approved-psa', studentId: 'student-1', requirementType: 'psa', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'psa.pdf', fileType: 'application/pdf', fileData: Buffer.from('psa') },
    { _id: 'approved-insurance', studentId: 'student-1', requirementType: 'insurance', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'insurance.pdf', fileType: 'application/pdf', fileData: Buffer.from('insurance') },
    { _id: 'approved-profile', studentId: 'student-1', requirementType: 'profile', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'profile.pdf', fileType: 'application/pdf', fileData: Buffer.from('profile') },
    { _id: 'approved-consent', studentId: 'student-1', requirementType: 'consent', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'consent.pdf', fileType: 'application/pdf', fileData: Buffer.from('consent') },
  ];

  it.each([
    {
      title: 'ignores rejected COR history when all required documents are approved',
      documents: [
        { _id: 'older-rejected', studentId: 'student-1', requirementType: 'cor', status: 'rejected', coachStatus: 'approved', sport: 'Basketball', fileName: 'old.pdf', fileType: 'application/pdf', fileData: Buffer.from('old'), uploadDate: new Date('2026-01-01') },
        { _id: 'newer-approved', studentId: 'student-1', requirementType: 'cor', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'new.pdf', fileType: 'application/pdf', fileData: Buffer.from('new'), uploadDate: new Date('2026-01-02') },
        ...approvedRequiredDocuments(),
      ],
      expectedOverallStatus: 'Completed',
    },
    {
      title: 'keeps a student incomplete when a new requirement is pending among approved requirements',
      documents: [
        { _id: 'approved-cor', studentId: 'student-1', requirementType: 'cor', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'cor.pdf', fileType: 'application/pdf', fileData: Buffer.from('cor'), uploadDate: new Date('2026-01-01') },
        { _id: 'approved-psa', studentId: 'student-1', requirementType: 'psa', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'psa.pdf', fileType: 'application/pdf', fileData: Buffer.from('psa'), uploadDate: new Date('2026-01-02') },
        { _id: 'pending-consent', studentId: 'student-1', requirementType: 'consent', status: 'pending', coachStatus: 'approved', sport: 'Basketball', fileName: 'consent.pdf', fileType: 'application/pdf', fileData: Buffer.from('consent'), uploadDate: new Date('2026-01-03') },
      ],
      expectedOverallStatus: 'Incomplete',
      expectedVisible: false,
    },
    {
      title: 'marks the student completed when all required documents and COR are approved',
      documents: [
        { _id: 'approved-cor', studentId: 'student-1', requirementType: 'cor', status: 'approved', coachStatus: 'approved', sport: 'Basketball', fileName: 'cor.pdf', fileType: 'application/pdf', fileData: Buffer.from('cor'), uploadDate: new Date('2026-01-01') },
        ...approvedRequiredDocuments(),
      ],
      expectedOverallStatus: 'Completed',
    },
    {
      title: 'marks the student completed when every required document is approved and no COR exists',
      documents: approvedRequiredDocuments(),
      expectedOverallStatus: 'Completed',
    },
    {
      title: 'marks the student incomplete when a required Medical Certificate is missing but COR is also absent',
      documents: approvedRequiredDocuments().filter((document) => document.requirementType !== 'medical'),
      expectedOverallStatus: 'Incomplete',
      expectedVisible: false,
    },
    {
      title: 'marks the student incomplete when a required Insurance document is rejected even if COR is absent',
      documents: approvedRequiredDocuments().map((document) => document.requirementType === 'insurance'
        ? { ...document, status: 'rejected' }
        : document),
      expectedOverallStatus: 'Incomplete',
    },
  ])('$title', async ({ documents, expectedOverallStatus, expectedVisible }) => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: 'student-1',
        fullname: 'Test Student',
        department: 'CICS',
        sports: ['Basketball']
      }]),
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ userId: 'student-1', sports: ['Basketball'] }])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(documents.map((document) => ({
        ...document,
        studentId: {
          _id: 'student-1',
          fullname: 'Test Student',
          department: 'CICS',
          sport: 'Basketball',
        },
      }))),
    });

    const response = await request(app).get('/api/v1/screener/requirements?participationType=Intrams');

    expect(response.status).toBe(200);
    if (expectedVisible === false) {
      expect(response.body.data).toEqual([]);
      return;
    }
    expect(response.body.data[0].overallStatus).toBe(expectedOverallStatus);
    expect(response.body.data[0].requirements.documents).toHaveLength(documents.length);
  });
});
