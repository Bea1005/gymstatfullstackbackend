const Requirement = require('../models/Requirement');
const RequirementSubmission = require('../models/RequirementSubmission');
const Announcement = require('../models/Announcement');

// ============================================
// ADMIN - Create Requirement
// ============================================
exports.createRequirement = async (req, res) => {
  try {
    console.log('📝 ADMIN: Creating new requirement');
    console.log('📝 All body keys:', Object.keys(req.body));
    console.log('📝 All body values:', req.body);
    console.log('📝 File info:', req.file ? `✅ File: ${req.file.originalname} (${req.file.size} bytes)` : '❌ No file');
    
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
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
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
    console.error('❌ Error creating requirement:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create requirement: ' + error.message
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
    
    // Mark as published
    await requirement.publish(req.user ? req.user._id : null);
    
    console.log(`✅ Requirement ${id} published to MongoDB`);
    
    // Create announcement for notification (linked to requirement)
    try {
      const announcement = new Announcement({
        title: `New Requirement: ${requirement.title}`,
        description: requirement.description || `A new ${requirement.type} requirement has been published.`,
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
      // Don't fail the whole operation if announcement fails
    }
    
    res.status(200).json({
      success: true,
      message: 'Requirement published successfully. Students will be notified.',
      data: requirement
    });
  } catch (error) {
    console.error('❌ Error publishing requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to publish requirement',
      error: error.message
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
      data: requirements
    });
  } catch (error) {
    console.error('❌ Error fetching requirements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirements',
      error: error.message
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
      data: requirements
    });
  } catch (error) {
    console.error('❌ Error fetching published requirements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirements',
      error: error.message
    });
  }
};

// ============================================
// Get Single Requirement
// ============================================
exports.getRequirementById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const requirement = await Requirement.findById(id)
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
      data: requirement
    });
  } catch (error) {
    console.error('❌ Error fetching requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirement',
      error: error.message
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
      data: updatedRequirement
    });
  } catch (error) {
    console.error('❌ Error updating requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update requirement',
      error: error.message
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
    
    // Delete the physical file from disk if it exists
    if (requirement.file && requirement.file.path) {
      try {
        const fs = require('fs');
        const path = require('path');
        
        if (fs.existsSync(requirement.file.path)) {
          fs.unlinkSync(requirement.file.path);
          console.log(`✅ File deleted from disk: ${requirement.file.path}`);
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
      data: deletedRequirement
    });
  } catch (error) {
    console.error('❌ Error deleting requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete requirement',
      error: error.message
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
    
    // Increment submission count on requirement
    await requirement.incrementSubmissionCount();
    
    console.log(`✅ Submission saved to MongoDB: ${submission._id}`);
    
    res.status(201).json({
      success: true,
      message: isLate ? 
        'Requirement submitted successfully (marked as late)' :
        'Requirement submitted successfully',
      data: submission
    });
  } catch (error) {
    console.error('❌ Error submitting requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit requirement',
      error: error.message
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
      data: submissions
    });
  } catch (error) {
    console.error('❌ Error fetching submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions',
      error: error.message
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
      data: submissions
    });
  } catch (error) {
    console.error('❌ Error fetching submissions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions',
      error: error.message
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
      data: submission
    });
  } catch (error) {
    console.error('❌ Error reviewing submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to review submission',
      error: error.message
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
    
    const path = require('path');
    const fs = require('fs');
    
    // Try multiple possible file paths
    const possiblePaths = [
      // Absolute path from database
      requirement.file.path,
      // Relative to backend root
      path.join(__dirname, '../../uploads/requirements', requirement.file.filename),
      // Direct filename in uploads directory
      path.join(__dirname, '../../uploads/requirements', path.basename(requirement.file.filename))
    ];
    
    console.log(`📍 Trying file paths:`, possiblePaths);
    
    let filePath = null;
    for (let p of possiblePaths) {
      if (fs.existsSync(p)) {
        filePath = p;
        console.log(`✅ File found at: ${filePath}`);
        break;
      }
    }
    
    if (!filePath) {
      console.error(`❌ File not found at any path. Stored path: ${requirement.file.path}`);
      console.error(`📂 Upload directory contents:`);
      const uploadDir = path.join(__dirname, '../../uploads/requirements');
      if (fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir);
        console.error(`   Files in upload dir: ${files.join(', ')}`);
      } else {
        console.error(`   Upload directory doesn't exist: ${uploadDir}`);
      }
      
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }
    
    // Set proper headers
    res.setHeader('Content-Type', requirement.file.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${requirement.file.originalname}"`);
    
    // Send file using stream
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      console.error('❌ Error streaming file:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error downloading file'
        });
      }
    });
    
    fileStream.pipe(res);
    
    fileStream.on('end', () => {
      console.log(`✅ File downloaded successfully: ${requirement.file.originalname}`);
    });
    
  } catch (error) {
    console.error('❌ Download error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to download file',
        error: error.message
      });
    }
  }
};

module.exports = exports;
