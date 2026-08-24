const mongoose = require('mongoose');
const Admin = require('./Admin');
const StudentAthlete = require('./StudentAthlete');
const Screener = require('./Screener');
const Coach = require('./Coach');

const baseUserSchema = new mongoose.Schema({
  fullname: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: false,
    default: '',
    sparse: true
  },
  contactNumber: {
    type: String,
    default: ''
  },
  dob: {
    type: String,
    default: ''
  },
  dateOfBirth: {
    type: String,
    default: ''
  },
  profilePhoto: {
    type: String,
    default: ''
  },
  notifications: {
    type: Boolean,
    default: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['student', 'coach', 'admin', 'screener'],
    default: 'student'
  },
  department: {
    type: String,
    default: ''
  },
  yearLevel: {
    type: String,
    enum: ['', 'I', 'II', 'III', 'IV'],
    default: ''
  },
  sport: {
    type: String,
    default: ''
  },
  branchCampus: {
    type: String,
    enum: ['', 'Boac Main', 'Santa Cruz', 'Gasan', 'Torrijos'],
    default: ''
  },
  id: {
    type: String,
    required: true,
    unique: true
  },
  sportParticipation: {
    type: [
      {
        role: { type: String, default: '' },
        level: { type: String, default: '' },
        years: { type: String, default: '' }
      }
    ],
    default: []
  },
  lastActiveAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Inactive'
  },
  adminLevel: {
    type: String,
    default: ''
  },
  permissions: {
    type: [String],
    default: []
  },
  screenerLevel: {
    type: String,
    default: ''
  },
  assignedSports: {
    type: [String],
    default: []
  },
  coachPosition: {
    type: String,
    default: ''
  },
  staffMembers: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  studentNumber: {
    type: String,
    default: ''
  },
  graduationYear: {
    type: String,
    default: ''
  },
  athleteStatus: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

baseUserSchema.index({ username: 1 }, { unique: true });
baseUserSchema.index({ id: 1 }, { unique: true });
baseUserSchema.index({ email: 1 }, { sparse: true });

const roleModelMap = {
  admin: Admin,
  student: StudentAthlete,
  screener: Screener,
  coach: Coach
};

const normalizeRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'student-athlete' || normalized === 'studentathlete' || normalized === 'student') return 'student';
  if (normalized === 'admin') return 'admin';
  if (normalized === 'screener') return 'screener';
  if (normalized === 'coach') return 'coach';
  return 'student';
};

const detectRoleFromId = (id) => {
  const trimmedId = String(id || '').trim();

  if (!trimmedId || trimmedId.length < 7 || /\s/.test(trimmedId) || !/^[A-Za-z0-9!@#$%^&*(),.?":{}|<>_-]+$/.test(trimmedId)) {
    return null;
  }

  if (trimmedId.toLowerCase().startsWith('screener') || trimmedId.toLowerCase().startsWith('sc')) {
    return 'screener';
  }

  if (trimmedId.toLowerCase().startsWith('admin')) {
    return 'admin';
  }

  if (/^[A-Za-z0-9]{7}$/.test(trimmedId)) {
    return 'student';
  }

  return 'coach';
};

const getRoleModel = (role) => {
  const normalizedRole = normalizeRole(role);
  return roleModelMap[normalizedRole] || StudentAthlete;
};

const buildRoleDocument = (user) => {
  const source = user && typeof user.toObject === 'function' ? user.toObject() : user;

  if (!source || !source._id) {
    return null;
  }

  const normalizedRole = normalizeRole(source.role);
  const roleDocPayload = {
    fullname: source.fullname || source.username || '',
    username: source.username || source.id || '',
    email: source.email || '',
    contactNumber: source.contactNumber || '',
    profilePhoto: source.profilePhoto || '',
    id: source.id || '',
    role: normalizedRole,
    status: source.status || 'Inactive',
    lastActiveAt: source.lastActiveAt || null
  };

  if (normalizedRole !== 'admin') {
    roleDocPayload.userId = source._id;
  }

  if (normalizedRole === 'admin') {
    roleDocPayload.password = source.password || '';
  } else {
    roleDocPayload.department = source.department || '';
    roleDocPayload.dateOfBirth = source.dateOfBirth || source.dob || '';
    roleDocPayload.yearLevel = source.yearLevel || '';
    roleDocPayload.sport = source.sport || '';
    roleDocPayload.branchCampus = source.branchCampus || '';
    roleDocPayload.adminLevel = source.adminLevel || '';
    roleDocPayload.permissions = Array.isArray(source.permissions) ? source.permissions : [];
    roleDocPayload.screenerLevel = source.screenerLevel || '';
    roleDocPayload.assignedSports = Array.isArray(source.assignedSports) ? source.assignedSports : [];
    roleDocPayload.coachPosition = source.coachPosition || '';
    roleDocPayload.staffMembers = Array.isArray(source.staffMembers) ? source.staffMembers : [];
    roleDocPayload.studentNumber = source.studentNumber || '';
    roleDocPayload.graduationYear = source.graduationYear || '';
    roleDocPayload.athleteStatus = source.athleteStatus || '';
    roleDocPayload.sportParticipation = Array.isArray(source.sportParticipation) ? source.sportParticipation : [];
  }

  return roleDocPayload;
};

const syncRoleDocument = async (user) => {
  if (!user || !user._id) {
    console.warn('syncRoleDocument skipped: missing user or _id', { user });
    return;
  }

  const normalizedRole = normalizeRole(user.role || detectRoleFromId(user.id));
  const targetModel = getRoleModel(normalizedRole);
  const source = user && typeof user.toObject === 'function' ? user.toObject() : user;
  const roleDocPayload = buildRoleDocument({ ...source, role: normalizedRole });

  if (!roleDocPayload) {
    console.warn('syncRoleDocument skipped: could not build payload for user', { userId: user._id, role: normalizedRole });
    return;
  }

  const updatePayload = { $set: roleDocPayload };
  const query = normalizedRole === 'admin'
    ? { id: roleDocPayload.id || source.id || '' }
    : { userId: user._id };

  if (normalizedRole === 'admin') {
    updatePayload.$unset = { department: '', sport: '' };
  }

  await targetModel.findOneAndUpdate(
    query,
    updatePayload,
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  for (const [roleKey, model] of Object.entries(roleModelMap)) {
    if (roleKey !== normalizedRole) {
      await model.deleteOne({ userId: user._id });
    }
  }
};

const syncAllRoleDocuments = async () => {
  const User = mongoose.model('User');
  const users = await User.find().lean();

  for (const user of users) {
    await syncRoleDocument(user);
  }
};

const initializeRoleCollections = async () => {
  await Promise.all(Object.values(roleModelMap).map((model) => model.syncIndexes()));
  await syncAllRoleDocuments();
};

const initializeCollections = initializeRoleCollections;

baseUserSchema.post('save', async function(doc) {
  try {
    await syncRoleDocument(doc);
  } catch (error) {
    console.error('Error syncing role document after save:', error);
  }
});

baseUserSchema.post('findOneAndUpdate', async function(doc) {
  if (!doc) return;
  try {
    await syncRoleDocument(doc);
  } catch (error) {
    console.error('Error syncing role document after findOneAndUpdate:', error);
  }
});

const User = mongoose.model('User', baseUserSchema, 'users');

User.normalizeRole = normalizeRole;
User.detectRoleFromId = detectRoleFromId;
User.getRoleModel = getRoleModel;
User.syncRoleDocument = syncRoleDocument;
User.syncAllRoleDocuments = syncAllRoleDocuments;
User.initializeRoleCollections = initializeRoleCollections;
User.initializeCollections = initializeCollections;

module.exports = User;
