const User = require('../../src/models/User');
const Coach = require('../../src/models/Coach');
const StudentAthlete = require('../../src/models/StudentAthlete');

describe('User collection adapter', () => {
  it('maps each supported role to the correct collection model', () => {
    expect(User.getRoleModel('admin').collection.name).toBe('admins');
    expect(User.getRoleModel('student').collection.name).toBe('studentathletes');
    expect(User.getRoleModel('screener').collection.name).toBe('screeners');
    expect(User.getRoleModel('coach').collection.name).toBe('coaches');
  });

  it('enforces case-normalized email uniqueness on canonical user accounts', () => {
    const normalizedEmailIndex = User.schema.indexes().find(
      ([fields]) => fields.emailNormalized === 1
    );

    expect(normalizedEmailIndex).toEqual([
      { emailNormalized: 1 },
      expect.objectContaining({ unique: true, sparse: true })
    ]);
  });

  it('checks canonical users for email uniqueness and ignores stale role-only records', async () => {
    const canonicalLookup = jest.spyOn(User.collection, 'findOne').mockResolvedValue(null);
    const roleModels = [
      User.getRoleModel('admin'),
      User.getRoleModel('student'),
      User.getRoleModel('screener'),
      User.getRoleModel('coach')
    ];
    const roleLookups = roleModels.map((model) => jest.spyOn(model.collection, 'findOne')
      .mockResolvedValue({ _id: 'orphan-role-record' }));

    try {
      await expect(User.hasRegisteredEmail('Coach.User@example.com')).resolves.toBe(false);
      expect(canonicalLookup).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            { emailNormalized: 'coach.user@example.com' },
            { email: { $regex: '^coach\\.user@example\\.com$', $options: 'i' } }
          ])
        }),
        { projection: { _id: 1 } }
      );
      roleLookups.forEach((lookup) => expect(lookup).not.toHaveBeenCalled());
    } finally {
      canonicalLookup.mockRestore();
      roleLookups.forEach((lookup) => lookup.mockRestore());
    }
  });

  it('rejects an email that belongs to a canonical account regardless of case', async () => {
    const canonicalLookup = jest.spyOn(User.collection, 'findOne')
      .mockResolvedValue({ _id: 'canonical-user' });

    try {
      await expect(User.hasRegisteredEmail('Coach.User@example.com')).resolves.toBe(true);
      expect(canonicalLookup).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            { emailNormalized: 'coach.user@example.com' },
            { email: { $regex: '^coach\\.user@example\\.com$', $options: 'i' } }
          ])
        }),
        { projection: { _id: 1 } }
      );
    } finally {
      canonicalLookup.mockRestore();
    }
  });

  it('checks canonical users for ID uniqueness and ignores stale role-only IDs', async () => {
    const canonicalLookup = jest.spyOn(User.collection, 'findOne').mockResolvedValue(null);
    const roleModels = [
      User.getRoleModel('admin'),
      User.getRoleModel('student'),
      User.getRoleModel('screener'),
      User.getRoleModel('coach')
    ];
    const roleLookups = roleModels.map((model) => jest.spyOn(model.collection, 'findOne')
      .mockResolvedValue({ _id: 'orphan-role-record' }));

    try {
      await expect(User.hasRegisteredId('23B1509')).resolves.toBe(false);
      expect(canonicalLookup).toHaveBeenCalledWith(
        { id: '23B1509' },
        { projection: { _id: 1 } }
      );
      roleLookups.forEach((lookup) => expect(lookup).not.toHaveBeenCalled());
    } finally {
      canonicalLookup.mockRestore();
      roleLookups.forEach((lookup) => lookup.mockRestore());
    }
  });

  it('synchronizes Coach records by the exact Coach ID', async () => {
    const roleModels = [
      User.getRoleModel('admin'),
      User.getRoleModel('student'),
      User.getRoleModel('screener')
    ];
    jest.spyOn(Coach, 'findOneAndUpdate').mockResolvedValue({});
    roleModels.forEach((model) => jest.spyOn(model, 'deleteOne').mockResolvedValue({ deletedCount: 0 }));

    await User.syncRoleDocument({
      _id: 'user123',
      fullname: 'Coach User',
      role: 'coach',
      id: '2019-0219'
    });

    expect(Coach.findOneAndUpdate).toHaveBeenCalledWith(
      { id: '2019-0219' },
      expect.objectContaining({
        $set: expect.objectContaining({
          id: '2019-0219',
          userId: 'user123',
          role: 'coach'
        })
      }),
      expect.objectContaining({ upsert: true })
    );
  });

  it('syncs multiple saved sports to the existing StudentAthlete role record', async () => {
    const roleModels = [
      User.getRoleModel('admin'),
      User.getRoleModel('coach'),
      User.getRoleModel('screener'),
    ];
    const deleteSpies = roleModels.map((model) => jest.spyOn(model, 'deleteOne').mockResolvedValue({ deletedCount: 0 }));
    const syncSpy = jest.spyOn(StudentAthlete, 'findOneAndUpdate').mockResolvedValue({});

    try {
      await User.syncRoleDocument({
        _id: 'student-user-id',
        id: '23B1510',
        fullname: 'Student Athlete',
        role: 'student',
        sport: 'Basketball Women',
        sports: ['Basketball Women', 'Volleyball Women'],
      });

      expect(syncSpy).toHaveBeenCalledWith(
        { userId: 'student-user-id' },
        expect.objectContaining({
          $set: expect.objectContaining({
            sport: 'Basketball Women',
            sports: ['Basketball Women', 'Volleyball Women'],
          }),
        }),
        expect.objectContaining({ upsert: true })
      );
    } finally {
      syncSpy.mockRestore();
      deleteSpies.forEach((spy) => spy.mockRestore());
    }
  });
});
