const User = require('../../src/models/User');

describe('User collection adapter', () => {
  it('maps each supported role to the correct collection model', () => {
    expect(User.getRoleModel('admin').collection.name).toBe('admins');
    expect(User.getRoleModel('student').collection.name).toBe('studentathletes');
    expect(User.getRoleModel('screener').collection.name).toBe('screeners');
    expect(User.getRoleModel('coach').collection.name).toBe('coaches');
  });
});
