const mongoose = require('mongoose');
const StudentRequirement = require('../models/StudentRequirement');
const Announcement = require('../models/Announcement');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

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

    const { requirementType, sport } = req.body;

    if (!requirementType) {
      // Delete uploaded file if validation fails
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Requirement type is required' });
    }

    const studentId = await resolveStudentObjectId(req);
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'Unable to resolve student account' });
    }

    const normalizedFilePath = path.resolve(req.file.path);

    const existingRejectedSubmission = await StudentRequirement.findOne({
      studentId,
      requirementType,
      status: 'rejected'
    }).sort({ uploadDate: -1 });

    if (existingRejectedSubmission) {
      const previousFilePath = existingRejectedSubmission.filePath;
      existingRejectedSubmission.fileName = req.file.originalname;
      existingRejectedSubmission.fileType = req.file.mimetype;
      existingRejectedSubmission.fileSize = req.file.size;
      existingRejectedSubmission.filePath = normalizedFilePath;
      existingRejectedSubmission.status = 'pending';
      existingRejectedSubmission.resubmitted = true;
      existingRejectedSubmission.remarks = '';
      existingRejectedSubmission.uploadDate = new Date();
      existingRejectedSubmission.approvalDate = null;
      existingRejectedSubmission.approvedBy = null;
      existingRejectedSubmission.reviewedAt = null;
      existingRejectedSubmission.reviewedBy = null;
      await existingRejectedSubmission.save();

      if (previousFilePath && previousFilePath !== normalizedFilePath && fs.existsSync(previousFilePath)) {
        fs.unlinkSync(previousFilePath);
      }

      return res.status(200).json({
        success: true,
        message: 'Rejected requirement updated successfully',
        data: existingRejectedSubmission
      });
    }

    const requirement = new StudentRequirement({
      studentId,
      requirementType,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      filePath: normalizedFilePath,
      sport: sport || 'General'
    });

    await requirement.save();

    res.status(201).json({
      success: true,
      message: 'Requirement uploaded successfully',
      data: requirement
    });
  } catch (error) {
    // Clean up file if error occurs
    if (req.file) {
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
    const { status, requirementType, sort = '-uploadDate' } = req.query;

    const studentId = await resolveStudentObjectId(req);
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'Unable to resolve student account' });
    }

    let filter = { studentId };
    if (status) filter.status = status;
    if (requirementType) filter.requirementType = requirementType;

    const requirements = await StudentRequirement.find(filter)
      .sort(sort)
      .populate('approvedBy', 'fullname')
      .populate('reviewedBy', 'fullname');

    // Calculate stats
    const stats = {
      total: requirements.length,
      pending: requirements.filter(r => r.status === 'pending').length,
      approved: requirements.filter(r => r.status === 'approved').length,
      rejected: requirements.filter(r => r.status === 'rejected').length
    };

    res.status(200).json({
      success: true,
      stats,
      data: requirements
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

    const pendingCount = requirements.filter((item) => item.status === 'pending').length;
    const approvedCount = requirements.filter((item) => item.status === 'approved').length;
    const rejectedCount = requirements.filter((item) => item.status === 'rejected').length;

    res.status(200).json({
      success: true,
      data: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        total: requirements.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
