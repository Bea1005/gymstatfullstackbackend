const assert = require('assert');
const dns = require('dns');
const path = require('path');
const { Writable } = require('stream');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const httpMocks = require('node-mocks-http');
const Schedule = require('../../src/models/Schedule');
const ScheduleRequest = require('../../src/models/ScheduleRequest');
const Requirement = require('../../src/models/Requirement');
const {
  createScheduleRequest,
  downloadScheduleRequestFile,
} = require('../../src/controllers/scheduleRequestController');
const {
  createRequirement,
  downloadRequirement,
} = require('../../src/controllers/requirementController');
const {
  storeUploadedFile,
  deleteStoredUpload,
  streamUploadFile,
} = require('../../src/config/uploadedFileStorage');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const runMongoIntegration = process.env.RUN_UPLOAD_MONGO_TESTS === 'true';
const describeMongo = runMongoIntegration ? describe : describe.skip;

describeMongo('uploaded file GridFS persistence integration', () => {
  let mongoUri;
  let storedReferences = [];
  let scheduleRequestIds = [];
  let requirementIds = [];

  beforeAll(async () => {
    mongoUri = process.env.FILE_STORAGE_TEST_MONGO_URI || process.env.MONGO_URI;
    if (!mongoUri) throw new Error('A dedicated MongoDB test URI is required.');

    const databaseName = decodeURIComponent(new URL(mongoUri).pathname.slice(1));
    if (databaseName !== 'test') {
      throw new Error('File storage integration tests only run against database "test".');
    }

    const dnsServers = String(process.env.MONGO_DNS_SERVERS || '')
      .split(',')
      .map((server) => server.trim())
      .filter(Boolean);
    if (dnsServers.length) dns.setServers(dnsServers);

    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 0 && mongoUri) {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
    }
    if (scheduleRequestIds.length) {
      await ScheduleRequest.deleteMany({ _id: { $in: scheduleRequestIds } });
    }
    if (requirementIds.length) {
      await Requirement.deleteMany({ _id: { $in: requirementIds } });
    }
    await Promise.all(storedReferences.map((reference) => deleteStoredUpload(reference)));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }, 30000);

  it('stores multiple files across a database reconnect and returns safe missing/deleted-file results', async () => {
    const contents = [
      Buffer.from('%PDF-1.7 schedule request fixture'),
      Buffer.from('%PDF-1.7 admin requirement fixture'),
    ];
    const uploads = await Promise.all(contents.map((buffer, index) => storeUploadedFile({
      buffer,
      filename: `storage-test-${Date.now()}-${index}.pdf`,
      contentType: 'application/pdf',
      metadata: { purpose: index === 0 ? 'schedule-request-attachment' : 'admin-requirement' },
    })));
    storedReferences = uploads.map((upload) => upload.reference);

    await mongoose.disconnect();
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

    for (const [index, upload] of uploads.entries()) {
      const chunks = [];
      const response = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });
      response.setHeader = () => {};
      response.attachment = () => {};

      const streamed = await streamUploadFile(upload.reference, response, {
        filename: upload.filename,
        contentType: 'application/pdf',
      });
      assert.strictEqual(streamed, true);
      assert.deepStrictEqual(Buffer.concat(chunks), contents[index]);
    }

    await deleteStoredUpload(uploads[0].reference);
    storedReferences = storedReferences.filter((reference) => reference !== uploads[0].reference);
    const missingChunks = [];
    const missingResponse = new Writable({
      write(chunk, _encoding, callback) {
        missingChunks.push(chunk);
        callback();
      },
    });
    missingResponse.setHeader = () => {};
    missingResponse.attachment = () => {};

    assert.strictEqual(await streamUploadFile(uploads[0].reference, missingResponse), false);
    assert.deepStrictEqual(missingChunks, []);
  }, 120000);

  it('persists schedule request and admin requirement records and downloads after reconnect', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fileBytes = Buffer.from('%PDF-1.7 controller upload fixture');
    const file = {
      buffer: fileBytes,
      originalname: `persistent-${suffix}.pdf`,
      mimetype: 'application/pdf',
      size: fileBytes.length,
    };
    const day = String(1 + Math.floor(Math.random() * 27)).padStart(2, '0');
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const requestDate = `2099-${month}-${day}`;

    const scheduleRequestResponse = httpMocks.createResponse();
    await createScheduleRequest(httpMocks.createRequest({
      body: {
        eventName: `Persistent request ${suffix}`,
        requesterName: 'GridFS Integration Test',
        requesterEmail: `gridfs-${suffix}@example.test`,
        requesterPhone: '09123456789',
        startDate: requestDate,
        endDate: requestDate,
        startTime: '8:00 AM',
        endTime: '9:00 AM',
        prepDays: 0,
      },
      file,
    }), scheduleRequestResponse);
    assert.strictEqual(scheduleRequestResponse.statusCode, 201);
    const scheduleRequestId = scheduleRequestResponse._getJSONData().data.id;
    scheduleRequestIds.push(scheduleRequestId);
    const savedScheduleRequest = await ScheduleRequest.findById(scheduleRequestId).lean();
    assert(savedScheduleRequest.file.storageKey.startsWith('gridfs://'));
    storedReferences.push(savedScheduleRequest.file.storageKey);

    const requirementResponse = httpMocks.createResponse();
    await createRequirement(httpMocks.createRequest({
      body: {
        title: `Persistent requirement ${suffix}`,
        type: 'medical',
        dueDate: '2099-12-31',
        isActive: 'true',
      },
      file,
      user: { _id: new mongoose.Types.ObjectId() },
    }), requirementResponse);
    assert.strictEqual(requirementResponse.statusCode, 201);
    const requirementId = requirementResponse._getJSONData().data._id;
    requirementIds.push(requirementId);
    const savedRequirement = await Requirement.findById(requirementId).lean();
    assert(savedRequirement.file.path.startsWith('gridfs://'));
    storedReferences.push(savedRequirement.file.path);

    await mongoose.disconnect();
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

    const scheduleChunks = [];
    const scheduleDownloadResponse = new Writable({
      write(chunk, _encoding, callback) {
        scheduleChunks.push(Buffer.from(chunk));
        callback();
      },
    });
    scheduleDownloadResponse.setHeader = () => {};
    scheduleDownloadResponse.attachment = () => {};
    await downloadScheduleRequestFile(
      httpMocks.createRequest({ params: { id: scheduleRequestId } }),
      scheduleDownloadResponse
    );
    assert.deepStrictEqual(Buffer.concat(scheduleChunks), fileBytes);

    const requirementChunks = [];
    const requirementDownloadResponse = new Writable({
      write(chunk, _encoding, callback) {
        requirementChunks.push(Buffer.from(chunk));
        callback();
      },
    });
    requirementDownloadResponse.setHeader = () => {};
    requirementDownloadResponse.attachment = () => {};
    await downloadRequirement(
      httpMocks.createRequest({ params: { id: requirementId } }),
      requirementDownloadResponse
    );
    assert.deepStrictEqual(Buffer.concat(requirementChunks), fileBytes);
  }, 120000);
});
