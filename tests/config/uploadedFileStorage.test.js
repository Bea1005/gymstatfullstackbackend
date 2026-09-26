const path = require('path');
const {
  getGridFsId,
  removeLegacyPathFromResponse,
  resolveLegacyUploadPath,
} = require('../../src/config/uploadedFileStorage');

describe('uploaded file storage references', () => {
  it('recognizes only well-formed GridFS ObjectId references', () => {
    expect(String(getGridFsId('gridfs://64b000000000000000000001'))).toBe('64b000000000000000000001');
    expect(getGridFsId('gridfs://not-an-object-id')).toBeNull();
    expect(getGridFsId('../private/file.pdf')).toBeNull();
  });

  it('redacts legacy absolute paths recursively without changing GridFS references', () => {
    const legacyPath = path.resolve('backend/uploads/requirements/old.pdf');
    const safe = removeLegacyPathFromResponse({
      file: { path: legacyPath, filename: 'old.pdf' },
      requirementId: {
        file: { path: 'gridfs://64b000000000000000000001', filename: 'new.pdf' }
      },
    });

    expect(safe.file.path).toBe('');
    expect(safe.file.filename).toBe('old.pdf');
    expect(safe.requirementId.file.path).toBe('gridfs://64b000000000000000000001');
  });

  it('does not resolve a legacy path outside the configured upload root', () => {
    const outsidePath = path.resolve('backend/uploads/private.pdf');
    expect(resolveLegacyUploadPath(outsidePath)).toBe('');
    expect(resolveLegacyUploadPath('../../private.pdf')).toBe('');
  });
});
