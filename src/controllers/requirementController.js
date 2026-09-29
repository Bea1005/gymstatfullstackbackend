const mongoose = require('mongoose');
const Requirement = require('../models/Requirement');
const RequirementSubmission = require('../models/RequirementSubmission');
const Announcement = require('../models/Announcement');
const {
  storeUploadedFile,
  deleteStoredUpload,
  getGridFsId,
  resolveLegacyUploadPath,
  streamUploadFile,
  removeLegacyPathFromResponse,
} = require('../config/uploadedFileStorage');

// ============================================
// ADMIN - Create Requirement
// ============================================
exports.createRequirement = async (req, res) => {
  let storedFileReference;
  try {
    console.log('📝 ADMIN: Creating new requirement');
    
    // Check if file was uploaded
    if (!req.file) {
      console.error('❌ No file uploaded');
      return res.status(400).json({
        success: false,
        message: 'File is required'
      });
    }
    
    // Get title from body
    const title = req.body.title || req.body['title'];
    const type = req.body.type || req.body['type'];
    const dueDate = req.body.dueDate || req.body['dueDate'];
    
    console.log(`📝 Extracted - Title: "${title}", Type: "${type}", DueDate: "${dueDate}"`);
    
    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }
    
    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Type is required'
      });
    }
    
    if (!dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Due date is required'
      });
    }
    
    const isActive = req.body.isActive === 'true' || req.body.isActive === true;
    
    const storedFile = await storeUploadedFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      metadata: { purpose: 'admin-requirement' },
    });
    storedFileReference = storedFile.reference;

    const requirementData = {
      title: title.trim(),
      description: (req.body.description || '').trim(),
      type: type.trim(),
      sport: (req.body.sport || 'General').trim(),
      priority: (req.body.priority || 'medium').trim(),
      dueDate: new Date(dueDate),
      instructions: (req.body.instructions || '').trim(),
      isActive: isActive,
      targetStudents: (req.body.targetStudents || 'all').trim(),
      publishedBy: req.user ? req.user._id : null,
      status: 'draft',
      file: {
        filename: storedFile.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: storedFile.reference
      }
    };
    
    console.log('📝 Final data:', {
      title: requirementData.title,
      type: requirementData.type,
      dueDate: requirementData.dueDate
    });
    
    const newRequirement = new Requirement(requirementData);
    await newRequirement.save();
    
    console.log(`✅ Requirement saved: ${newRequirement._id}`);
    
    res.status(201).json({
      success: true,
      message: 'Requirement created successfully',
      data: newRequirement
    });
  } catch (error) {
    if (storedFileReference) await deleteStoredUpload(storedFileReference).catch(() => {});
    console.error('❌ Error creating requirement:', error.message);
    res.status(500).json({
      success: false,
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// ADMIN - Publish Requirement
// ============================================
exports.publishRequirement = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`📢 ADMIN: Publishing requirement ${id}`);
    
    const requirement = await Requirement.findById(id);
    
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    const existingAnnouncement = await Announcement.findOne({ relatedRequirementId: requirement._id });
    const wasPublished = requirement.status === 'published';
    const previousPublication = {
      status: requirement.status,
      publishedAt: requirement.publishedAt,
      publishedBy: requirement.publishedBy,
    };

    if (!wasPublished) {
      await requirement.publish(req.user ? req.user._id : null);
      console.log(`✅ Requirement ${id} published to MongoDB`);
    }

    if (!existingAnnouncement) {
      const requirementType = requirement.type || 'requirement';
      const dueDate = requirement.dueDate
        ? new Date(requirement.dueDate).toISOString().slice(0, 10)
        : '';
      const targetScope = requirement.targetStudents === 'sport-specific'
        ? `Students in ${requirement.sport || 'the specified sport'}`
        : 'All students';
      const announcementDescription = [
        requirement.description?.trim(),
        requirement.instructions?.trim() ? `Instructions: ${requirement.instructions.trim()}` : '',
        `Requirement type: ${requirementType}`,
        dueDate ? `Due date: ${dueDate}` : '',
        `Target: ${targetScope}`,
      ].filter(Boolean).join('\n\n');

      try {
        const announcement = new Announcement({
        title: `New Requirement: ${requirement.title}`,
        description: announcementDescription,
        type: 'requirement',
        sport: requirement.sport,
        createdBy: req.user ? req.user._id : null,
        date: new Date(),
        isActive: true,
        relatedRequirementId: requirement._id
        });

        await announcement.save();
        console.log(`✅ Announcement created for requirement ${id}`);
      } catch (announcementError) {
        console.error('⚠️  Failed to create announcement:', announcementError);
        if (!wasPublished) {
          try {
            requirement.status = previousPublication.status;
            requirement.publishedAt = previousPublication.publishedAt;
            requirement.publishedBy = previousPublication.publishedBy;
            await requirement.save();
          } catch (rollbackError) {
            console.error('❌ Failed to roll back requirement publication:', rollbackError);
          }
        }

        return res.status(500).json({
          success: false,
          message: 'Requirement publishing could not complete because its announcement could not be saved. Please retry.'
        });
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Requirement published successfully. Students will be notified.',
      data: removeLegacyPathFromResponse(requirement)
    });
  } catch (error) {
    console.error('❌ Error publishing requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to publish requirement',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// ADMIN - Get All Requirements
// ============================================
exports.getAllRequirements = async (req, res) => {
  try {
    console.log('📋 ADMIN: Fetching all requirements from MongoDB');
    
    const { status, sport, type } = req.query;
    const filter = {};
    
    if (status) filter.status = status;
    if (sport) filter.sport = sport;
    if (type) filter.type = type;
    
    const requirements = await Requirement.find(filter)
      .populate('publishedBy', 'fullname email')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`✅ Retrieved ${requirements.length} requirements from MongoDB`);
    
    res.status(200).json({
      success: true,
      count: requirements.length,
      data: removeLegacyPathFromResponse(requirements)
    });
  } catch (error) {
    console.error('❌ Error fetching requirements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirements',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// STUDENT - Get Published Requirements
// ============================================
exports.getPublishedRequirements = async (req, res) => {
  try {
    console.log('📋 STUDENT: Fetching published requirements from MongoDB');
    
    const { sport, type } = req.query;
    const filter = { status: 'published', isActive: true };
    
    if (sport && sport !== 'General') {
      filter.$or = [{ sport }, { sport: 'General' }];
    }
    if (type) filter.type = type;
    
    const requirements = await Requirement.find(filter)
      .select('-__v')
      .sort({ publishedAt: -1 })
      .lean();
    
    // If user is authenticated, check which requirements they've submitted
    if (req.user) {
      const studentId = req.user._id;
      const submissions = await RequirementSubmission.find({
        studentId,
        requirementId: { $in: requirements.map(r => r._id) }
      }).select('requirementId status').lean();
      
      const submissionMap = {};
      submissions.forEach(sub => {
        submissionMap[sub.requirementId.toString()] = sub.status;
      });
      
      // Add submission status to each requirement
      requirements.forEach(req => {
        req.submissionStatus = submissionMap[req._id.toString()] || 'not-submitted';
      });
    }
    
    console.log(`✅ Retrieved ${requirements.length} published requirements from MongoDB`);
    
    res.status(200).json({
      success: true,
      count: requirements.length,
      data: removeLegacyPathFromResponse(requirements)
    });
  } catch (error) {
    console.error('❌ Error fetching published requirements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirements',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// Get Single Requirement
// ============================================
exports.getRequirementById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    const role = String(req.user?.role || '').toLowerCase();
    const filter = { _id: id };

    if (role === 'student') {
      const studentSports = [
        req.user?.sport,
        ...(Array.isArray(req.user?.assignedSports) ? req.user.assignedSports : []),
        ...(Array.isArray(req.user?.sportParticipation)
          ? req.user.sportParticipation.map((participation) => participation?.sport)
          : []),
      ].filter(Boolean).map((sport) => String(sport).trim());

      filter.status = 'published';
      filter.isActive = true;
      filter.$or = [
        { targetStudents: 'all' },
        {
          targetStudents: 'sport-specific',
          sport: { $in: studentSports },
        },
      ];
    }

    const requirement = await Requirement.findOne(filter)
      .populate('publishedBy', 'fullname email')
      .lean();
    
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }
    
    // Increment view count
    await Requirement.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });
    
    res.status(200).json({
      success: true,
      data: removeLegacyPathFromResponse(requirement)
    });
  } catch (error) {
    console.error('❌ Error fetching requirement');
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirement'
    });
  }
};

// ============================================
// ADMIN - Update Requirement
// ============================================
exports.updateRequirement = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`✏️ ADMIN: Updating requirement ${id}`);
    
    const updatedRequirement = await Requirement.findByIdAndUpdate(
      id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!updatedRequirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }
    
    console.log(`✅ Requirement ${id} updated in MongoDB`);
    
    res.status(200).json({
      success: true,
      message: 'Requirement updated successfully',
      data: removeLegacyPathFromResponse(updatedRequirement)
    });
  } catch (error) {
    console.error('❌ Error updating requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update requirement',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// ADMIN - Delete Requirement
// ============================================
exports.deleteRequirement = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🗑️ ADMIN: Deleting requirement ${id}`);
    
    // Find the requirement first to get file path
    const requirement = await Requirement.findById(id);
    
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }
    
    // Delete the stored upload while retaining compatibility with legacy disk references.
    if (requirement.file && requirement.file.path) {
      try {
        const fs = require('fs');
        if (getGridFsId(requirement.file.path)) {
          await deleteStoredUpload(requirement.file.path);
        } else {
          const legacyPath = resolveLegacyUploadPath(requirement.file.path, requirement.file.filename);
          if (legacyPath && fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
        }
      } catch (fileError) {
        console.warn(`⚠️ Warning: Could not delete file from disk:`, fileError.message);
        // Continue with database deletion even if file deletion fails
      }
    }
    
    // Delete from MongoDB
    const deletedRequirement = await Requirement.findByIdAndDelete(id);
    
    // Also delete all submissions for this requirement
    await RequirementSubmission.deleteMany({ requirementId: id });
    
    // Delete associated announcements
    const Announcement = require('../models/Announcement');
    await Announcement.deleteMany({ relatedRequirementId: id });
    
    console.log(`✅ Requirement ${id}, all submissions, and announcements deleted from MongoDB`);
    
    res.status(200).json({
      success: true,
      message: 'Requirement deleted successfully',
      data: removeLegacyPathFromResponse(deletedRequirement)
    });
  } catch (error) {
    console.error('❌ Error deleting requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete requirement',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// STUDENT - Submit Requirement
// ============================================
exports.submitRequirement = async (req, res) => {
  try {
    const { requirementId } = req.params;
    const studentId = req.user._id;
    
    console.log(`📤 STUDENT: Submitting requirement ${requirementId}`);
    
    // Check if requirement exists and is published
    const requirement = await Requirement.findById(requirementId);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }
    
    if (requirement.status !== 'published') {
      return res.status(400).json({
        success: false,
        message: 'This requirement is not published yet'
      });
    }
    
    // Check if already submitted
    const existingSubmission = await RequirementSubmission.findOne({
      requirementId,
      studentId
    });
    
    if (existingSubmission) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted this requirement'
      });
    }
    
    // Check if late
    const isLate = new Date() > requirement.dueDate;
    
    const submission = new RequirementSubmission({
      requirementId,
      studentId,
      file: req.body.file,
      status: 'submitted',
      isLate,
      remarks: req.body.remarks || ''
    });

    await submission.save();

    await requirement.incrementSubmissionCount();

    console.log(`✅ Submission saved to MongoDB: ${submission._id}`);

    res.status(201).json({
      success: true,
      message: isLate
        ? 'Requirement submitted successfully (marked as late)'
        : 'Requirement submitted successfully',
      data: submission
    });
  } catch (error) {
    console.error('❌ Error submitting requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit requirement',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// STUDENT - Get My Submissions
// ============================================
exports.getMySubmissions = async (req, res) => {
  try {
    const studentId = req.user._id;

    console.log(`📋 STUDENT: Fetching submissions for student ${studentId}`);

    const { status } = req.query;
    const filter = { studentId };

    if (status) filter.status = status;

    const submissions = await RequirementSubmission.find(filter)
      .populate('requirementId')
      .populate('reviewedBy', 'fullname email')
      .sort({ submittedAt: -1 })
      .lean();

    console.log(`✅ Retrieved ${submissions.length} submissions from MongoDB`);

    res.status(200).json({
      success: true,
      count: submissions.length,
      data: removeLegacyPathFromResponse(submissions)
    });
  } catch (error) {
    console.error('❌ Error fetching submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// ADMIN - Get All Submissions
// ============================================
exports.getAllSubmissions = async (req, res) => {
  try {
    console.log('📋 ADMIN: Fetching all submissions from MongoDB');
    
    const { status, requirementId } = req.query;
    const filter = {};
    
    if (status) filter.status = status;
    if (requirementId) filter.requirementId = requirementId;
    
    const submissions = await RequirementSubmission.find(filter)
      .populate('studentId', 'fullname email id sport')
      .populate('requirementId')
      .populate('reviewedBy', 'fullname email')
      .sort({ submittedAt: -1 })
      .lean();
    
    console.log(`✅ Retrieved ${submissions.length} submissions from MongoDB`);
    
    res.status(200).json({
      success: true,
      count: submissions.length,
      data: removeLegacyPathFromResponse(submissions)
    });
  } catch (error) {
    console.error('❌ Error fetching submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// ADMIN - Review Submission
// ============================================
exports.reviewSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback, grade } = req.body;
    
    console.log(`✏️ ADMIN: Reviewing submission ${id}`);
    
    const submission = await RequirementSubmission.findByIdAndUpdate(
      id,
      {
        status,
        feedback,
        grade,
        reviewedAt: new Date(),
        reviewedBy: req.user ? req.user._id : null
      },
      { new: true, runValidators: true }
    ).populate('studentId', 'fullname email')
     .populate('requirementId');
    
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }
    
    console.log(`✅ Submission ${id} reviewed and updated in MongoDB`);
    
    res.status(200).json({
      success: true,
      message: 'Submission reviewed successfully',
      data: removeLegacyPathFromResponse(submission)
    });
  } catch (error) {
    console.error('❌ Error reviewing submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to review submission',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// ============================================
// STUDENT - Download Requirement File
// ============================================
exports.downloadRequirement = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`📥 Download request for requirement ${id}`);
    
    const requirement = await Requirement.findById(id);
    
    if (!requirement) {
      console.warn(`❌ Requirement not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }
    
    // Check if file exists in database
    if (!requirement.file || !requirement.file.filename) {
      console.warn(`❌ No file attached to requirement ${id}`);
      return res.status(404).json({
        success: false,
        message: 'File not available for download'
      });
    }
    
    const storedReference = requirement.file.path || requirement.file.filename;
    const streamed = await streamUploadFile(storedReference, res, {
      filename: requirement.file.originalname || requirement.file.filename,
      contentType: requirement.file.mimetype || 'application/octet-stream',
      fallbackFilename: requirement.file.filename,
    });

    if (!streamed) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    return res;
    
  } catch (error) {
    console.error('❌ Download error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'An unexpected server error occurred. Please try again.'
      });
    }
  }
};

module.exports = exports;
