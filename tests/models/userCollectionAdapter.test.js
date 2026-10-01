const User = require('../../src/models/User');
const Coach = require('../../src/models/Coach');

describe('User collection adapter', () => {
  it('maps each supported role to the correct collection model', () => {
    expect(User.getRoleModel('admin').collection.name).toBe('admins');
    expect(User.getRoleModel('student').collection.name).toBe('studentathletes');
    expect(User.getRoleModel('screener').collection.name).toBe('screeners');
    expect(User.getRoleModel('coach').collection.name).toBe('coaches');
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
});
