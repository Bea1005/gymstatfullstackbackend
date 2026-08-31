const mongoose = require('mongoose');
const StudentRequirement = require('../models/StudentRequirement');
const Announcement = require('../models/Announcement');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

const getAcademicYearLabel = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth();

  if (month >= 5) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }

  return `${year - 1}-${String(year).slice(-2)}`;
};

const isReusableRequirement = (record) => {
  if (!record) return false;
  return Boolean(record.isReusable || record.requirementStatus === 'reusable' || record.requirementType === 'psa');
};

exports.buildRequirementLifecycleState = (record = {}, currentAcademicYear = getAcademicYearLabel()) => {
  if (!record) return 'active';

  if (record.requirementStatus === 'archived' || record.archivedAt) {
    return 'archived';
  }

  if (record.requirementStatus === 'reusable' || record.isReusable) {
    return 'reusable';
  }

  if (record.requirementStatus === 'expired') {
    return 'expired';
  }

  if (record.requirementType === 'psa' && record.importedFromPreviousYear) {
    return 'reusable';
  }

  if (record.academicYear && currentAcademicYear && record.academicYear !== currentAcademicYear && record.status === 'approved') {
    return 'expired';
  }

  return 'active';
};

const syncRequirementLifecycleState = async (record, currentAcademicYear) => {
  if (!record || !record._id) return record;

  const nextLifecycle = exports.buildRequirementLifecycleState(record, currentAcademicYear);
  const shouldReuse = isReusableRequirement(record) || nextLifecycle === 'reusable';

  const updates = {
    requirementStatus: nextLifecycle,
    isReusable: shouldReuse,
    archivedAt: nextLifecycle === 'archived' ? (record.archivedAt || new Date()) : null,
    archivedReason: nextLifecycle === 'archived' ? (record.archivedReason || 'Academic year closed and requirement is no longer eligible for reuse.') : '',
    expiresAt: nextLifecycle === 'expired' ? (record.expiresAt || new Date()) : null
  };

  if (nextLifecycle === 'reusable' && record.requirementType === 'psa') {
    updates.previousAcademicYear = record.academicYear || record.previousAcademicYear || '';
  }

  const savedRecord = await StudentRequirement.findByIdAndUpdate(record._id, { $set: updates }, { new: true }).lean();
  return savedRecord || record;
};

const archiveNonReusableRequirements = async (studentId, currentAcademicYear) => {
  const previousYearRequirements = await StudentRequirement.find({
    studentId,
    status: 'approved',
    requirementType: { $ne: 'psa' },
    academicYear: { $ne: currentAcademicYear }
  }).lean();

  for (const record of previousYearRequirements) {
    const lifecycle = exports.buildRequirementLifecycleState(record, currentAcademicYear);
    if (lifecycle === 'expired') {
      await syncRequirementLifecycleState(record, currentAcademicYear);
    }
  }
};

const resolveStudentObjectId = async (req) => {
  if (!req?.user) return null;

  const directValue = req.user._id || req.user.id;
  if (!directValue) return null;

  const directValueString = String(directValue);
  if (mongoose.Types.ObjectId.isValid(directValueString)) {
    return new mongoose.Types.ObjectId(directValueString);
  }

  const userDoc = await User.findOne({ id: directValueString }).select('_id').lean();
  if (userDoc?._id) {
    return userDoc._id;
  }

  return null;
};

// @desc Upload a new requirement
// @route POST /api/student/requirements
// @access Private (Student only)
exports.uploadRequirement = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { requirementType, sport, participationType, requirementId, customRequirementLabel } = req.body;
    const normalizedRequirementType = String(requirementType || '').trim().toLowerCase();
    const normalizedParticipationType = participationType === 'STRASUC' ? 'STRASUC' : 'Intrams';
    const customRequirementKey = requirementId ? String(requirementId).trim() : '';

    if (!normalizedRequirementType) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Requirement type is required' });
    }

    const studentId = await resolveStudentObjectId(req);
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'Unable to resolve student account' });
    }

    const currentAcademicYear = getAcademicYearLabel();
    const normalizedFilePath = path.resolve(req.file.path);

    const replacementQuery = {
      studentId,
      requirementType: normalizedRequirementType,
      participationType: normalizedParticipationType,
    };

    if (normalizedRequirementType === 'other' && customRequirementKey) {
      replacementQuery.customRequirementId = customRequirementKey;
    }

    const reusableSubmission = await StudentRequirement.findOne({
      ...replacementQuery,
      status: 'approved',
      requirementStatus: 'reusable'
    }).sort({ uploadDate: -1 });

    const existingRejectedSubmission = await StudentRequirement.findOne({
      ...replacementQuery,
      status: 'rejected'
    }).sort({ uploadDate: -1 });

    const replacementTarget = reusableSubmission || existingRejectedSubmission;

    if (replacementTarget) {
      const previousFilePath = replacementTarget.filePath;
      replacementTarget.fileName = req.file.originalname;
      replacementTarget.fileType = req.file.mimetype;
      replacementTarget.fileSize = req.file.size;
      replacementTarget.filePath = normalizedFilePath;
      replacementTarget.status = 'pending';
      replacementTarget.requirementStatus = 'active';
      replacementTarget.isReusable = false;
      replacementTarget.importedFromPreviousYear = false;
      replacementTarget.academicYear = currentAcademicYear;
      replacementTarget.previousAcademicYear = replacementTarget.previousAcademicYear || replacementTarget.academicYear || '';
      replacementTarget.resubmitted = true;
      replacementTarget.remarks = '';
      replacementTarget.uploadDate = new Date();
      replacementTarget.approvalDate = null;
      replacementTarget.approvedBy = null;
      replacementTarget.reviewedAt = null;
      replacementTarget.reviewedBy = null;
      replacementTarget.archivedAt = null;
      replacementTarget.archivedReason = '';
      replacementTarget.expiresAt = null;
      replacementTarget.participationType = normalizedParticipationType;
      replacementTarget.customRequirementId = normalizedRequirementType === 'other' ? (customRequirementKey || replacementTarget.customRequirementId || '') : '';
      replacementTarget.customRequirementLabel = normalizedRequirementType === 'other' ? (customRequirementLabel || replacementTarget.customRequirementLabel || '') : '';
      await replacementTarget.save();

      if (previousFilePath && previousFilePath !== normalizedFilePath && fs.existsSync(previousFilePath)) {
        fs.unlinkSync(previousFilePath);
      }

      return res.status(200).json({
        success: true,
        message: reusableSubmission ? 'Reusable requirement updated successfully' : 'Rejected requirement updated successfully',
        data: replacementTarget
      });
    }

    const requirement = new StudentRequirement({
      studentId,
      requirementType: normalizedRequirementType,
      participationType: normalizedParticipationType,
      customRequirementId: normalizedRequirementType === 'other' ? customRequirementKey : '',
      customRequirementLabel: normalizedRequirementType === 'other' ? (customRequirementLabel || '') : '',
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      filePath: normalizedFilePath,
      sport: sport || 'General',
      academicYear: currentAcademicYear,
      requirementStatus: 'active'
    });

    await requirement.save();

    res.status(201).json({
      success: true,
      message: 'Requirement uploaded successfully',
      data: requirement
    });
  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get all requirements for a student
// @route GET /api/student/requirements
// @access Private (Student only)
exports.getStudentRequirements = async (req, res) => {
  try {
    const { status, requirementType, participationType, sort = '-uploadDate' } = req.query;

    const studentId = await resolveStudentObjectId(req);
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'Unable to resolve student account' });
    }

    const currentAcademicYear = getAcademicYearLabel();
    await archiveNonReusableRequirements(studentId, currentAcademicYear);

    let filter = { studentId };
    if (status) filter.status = status;
    if (requirementType) filter.requirementType = requirementType;
    if (participationType) filter.participationType = participationType;

    const requirements = await StudentRequirement.find(filter)
      .sort(sort)
      .populate('approvedBy', 'fullname')
      .populate('reviewedBy', 'fullname');

    const enrichedRequirements = requirements.map((requirement) => {
      const lifecycle = exports.buildRequirementLifecycleState(requirement.toObject ? requirement.toObject() : requirement, currentAcademicYear);
      return {
        ...requirement.toObject ? requirement.toObject() : requirement,
        requirementStatus: lifecycle,
        isReusable: lifecycle === 'reusable' || isReusableRequirement(requirement)
      };
    });

    const stats = {
      total: enrichedRequirements.length,
      pending: enrichedRequirements.filter(r => r.status === 'pending').length,
      approved: enrichedRequirements.filter(r => r.status === 'approved').length,
      rejected: enrichedRequirements.filter(r => r.status === 'rejected').length,
      expired: enrichedRequirements.filter(r => r.requirementStatus === 'expired').length,
      archived: enrichedRequirements.filter(r => r.requirementStatus === 'archived').length,
      reusable: enrichedRequirements.filter(r => r.requirementStatus === 'reusable').length
    };

    res.status(200).json({
      success: true,
      stats,
      data: enrichedRequirements
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.importPreviousYearRequirements = async (req, res) => {
  try {
    const studentId = await resolveStudentObjectId(req);
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'Unable to resolve student account' });
    }

    const { sourceAcademicYear } = req.body || {};
    const targetAcademicYear = getAcademicYearLabel();
    const yearToImport = sourceAcademicYear || getAcademicYearLabel(new Date(new Date().getFullYear() - 1, 5, 1));

    const previousYearRequirements = await StudentRequirement.find({
      studentId,
      status: 'approved',
      academicYear: yearToImport
    }).sort({ uploadDate: -1 });

    const importedRecords = [];

    for (const record of previousYearRequirements) {
      const alreadyImported = await StudentRequirement.findOne({
        studentId,
        requirementType: record.requirementType,
        academicYear: targetAcademicYear,
        importedFromPreviousYear: true,
        sourceRequirementId: record._id
      });

      if (alreadyImported) continue;

      const reusable = record.requirementType === 'psa' || record.isReusable || record.requirementStatus === 'reusable';
      const candidate = new StudentRequirement({
        ...record.toObject(),
        _id: new mongoose.Types.ObjectId(),
        status: 'approved',
        requirementStatus: reusable ? 'reusable' : 'expired',
        academicYear: targetAcademicYear,
        previousAcademicYear: record.academicYear || yearToImport,
        importedFromPreviousYear: true,
        isReusable: reusable,
        sourceRequirementId: record._id,
        reviewedAt: null,
        reviewedBy: null,
        approvalDate: new Date(),
        uploadDate: new Date(),
        archivedAt: null,
        archivedReason: '',
        expiresAt: reusable ? null : new Date(),
        remarks: ''
      });

      await candidate.save();
      importedRecords.push(candidate);
    }

    res.status(200).json({
      success: true,
      message: importedRecords.length > 0 ? 'Previous-year records imported successfully' : 'No eligible records were available to import',
      data: importedRecords
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Download a requirement file
// @route GET /api/student/requirements/:id/download
// @access Private (Student or Admin)
exports.downloadRequirement = async (req, res) => {
  try {
    const requirement = await StudentRequirement.findById(req.params.id);

    if (!requirement) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    const studentId = await resolveStudentObjectId(req);

    // Check authorization: student can download own, admin can download any
    if (req.user.role !== 'admin' && requirement.studentId.toString() !== studentId?.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to download this file' });
    }

    const resolvedFilePath = requirement.filePath && path.isAbsolute(requirement.filePath)
      ? requirement.filePath
      : path.resolve(requirement.filePath || '');

    // Check if file exists
    if (!resolvedFilePath || !fs.existsSync(resolvedFilePath)) {
      return res.status(404).json({ success: false, message: 'The uploaded file is no longer available on the server.' });
    }

    res.download(resolvedFilePath, requirement.fileName || path.basename(resolvedFilePath));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Delete a requirement (only pending ones)
// @route DELETE /api/student/requirements/:id
// @access Private (Student only)
exports.deleteRequirement = async (req, res) => {
  try {
    const requirement = await StudentRequirement.findById(req.params.id);

    if (!requirement) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    const studentId = await resolveStudentObjectId(req);

    // Check authorization
    if (requirement.studentId.toString() !== studentId?.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this requirement' });
    }

    // Only allow deletion of pending requirements
    if (requirement.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Can only delete pending requirements' });
    }

    // Delete file from server
    if (fs.existsSync(requirement.filePath)) {
      fs.unlinkSync(requirement.filePath);
    }

    await StudentRequirement.findByIdAndDelete(req.params.id);

    res.status(200).json({ success: true, message: 'Requirement deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get all announcements
// @route GET /api/announcements
// @access Public
exports.getAnnouncements = async (req, res) => {
  try {
    const { sport, type, limit = 10 } = req.query;

    let filter = { isActive: true };
    if (sport) filter.sport = sport;
    if (type) filter.type = type;

    const announcements = await Announcement.find(filter)
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .populate('createdBy', 'fullname');

    res.status(200).json({
      success: true,
      count: announcements.length,
      data: announcements
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Get pending count for student dashboard
// @route GET /api/student/stats
// @access Private (Student only)
exports.getStudentStats = async (req, res) => {
  try {
    const studentId = await resolveStudentObjectId(req);
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'Unable to resolve student account' });
    }

    const requirements = await StudentRequirement.find({ studentId }).lean();
    const currentAcademicYear = getAcademicYearLabel();

    const pendingCount = requirements.filter((item) => item.status === 'pending').length;
    const approvedCount = requirements.filter((item) => item.status === 'approved').length;
    const rejectedCount = requirements.filter((item) => item.status === 'rejected').length;
    const expiredCount = requirements.filter((item) => exports.buildRequirementLifecycleState(item, currentAcademicYear) === 'expired').length;
    const archivedCount = requirements.filter((item) => exports.buildRequirementLifecycleState(item, currentAcademicYear) === 'archived').length;
    const reusableCount = requirements.filter((item) => exports.buildRequirementLifecycleState(item, currentAcademicYear) === 'reusable').length;

    res.status(200).json({
      success: true,
      data: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        expired: expiredCount,
        archived: archivedCount,
        reusable: reusableCount,
        total: requirements.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
