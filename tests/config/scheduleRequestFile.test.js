const {
  scheduleRequestFileFilter,
} = require('../../src/config/multer');
const {
  isValidScheduleRequestFile,
} = require('../../src/controllers/scheduleRequestController');

const validSignatures = [
  {
    originalname: 'request.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n'),
  },
  {
    originalname: 'request.png',
    mimetype: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  },
  {
    originalname: 'request.jpg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  },
  {
    originalname: 'request.jpeg',
    mimetype: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  },
];

describe('schedule request attachment validation', () => {
  it.each(validSignatures)('accepts a valid $originalname upload by signature and type', (file) => {
    const callback = jest.fn();

    scheduleRequestFileFilter({}, file, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
    expect(isValidScheduleRequestFile(file)).toBe(true);
  });

  it.each([
    {
      originalname: 'request.doc',
      mimetype: 'application/msword',
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
    },
    {
      originalname: 'fake.jpg',
      mimetype: 'image/png',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    },
  ])('rejects unsupported or mismatched upload $originalname', (file) => {
    const callback = jest.fn();

    scheduleRequestFileFilter({}, file, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), false);
    expect(isValidScheduleRequestFile(file)).toBe(false);
  });

  it.each([
    {
      originalname: 'fake.png',
      mimetype: 'image/png',
      buffer: Buffer.from('%PDF-1.7\n'),
    },
    {
      originalname: 'fake.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('not a PDF'),
    },
  ])('rejects file contents that do not match the declared format for $originalname', (file) => {
    const callback = jest.fn();

    scheduleRequestFileFilter({}, file, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
    expect(isValidScheduleRequestFile(file)).toBe(false);
  });
});
