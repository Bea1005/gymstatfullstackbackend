const ScheduleRequest = require('../models/ScheduleRequest');
const Schedule = require('../models/Schedule');
const mongoose = require('mongoose');
const { findScheduleConflict } = require('../utils/scheduleConflicts');
const { acquireScheduleConflictLock } = require('../utils/withScheduleConflictLock');
const {
  storeUploadedFile,
  deleteStoredUpload,
  streamUploadFile,
  removeLegacyPathFromResponse,
} = require('../config/uploadedFileStorage');

const isValidScheduleRequestFile = (file) => {
  if (!Buffer.isBuffer(file?.buffer)) return false;
  const fileHeader = file.buffer.subarray(0, 4);
  const bytesRead = fileHeader.length;

  if (file.mimetype === 'application/pdf') return bytesRead >= 4 && fileHeader.toString('ascii', 0, 4) === '%PDF';
  if (file.mimetype === 'application/msword') return bytesRead >= 4 && fileHeader.equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0]));
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return bytesRead >= 4 && fileHeader[0] === 0x50 && fileHeader[1] === 0x4B;
  }
  return false;
};

// Create a new schedule request
exports.createScheduleRequest = async (req, res) => {
  let storedFileReference;
  try {
    if (!isValidScheduleRequestFile(req.file)) {
      return res.status(400).json({ success: false, message: 'The uploaded request letter could not be verified.' });
    }

    const requestData = {
      eventName: req.body.eventName,
      requesterName: req.body.requesterName,
      requesterEmail: req.body.requesterEmail,
      requesterPhone: req.body.requesterPhone,
      organization: req.body.organization || '',
      purpose: req.body.purpose || '',
      details: req.body.details || '',
      startDate: req.body.startDate,
      startTime: req.body.startTime,
      endDate: req.body.endDate,
      endTime: req.body.endTime,
      prepDays: req.body.prepDays,
      status: 'pending'
    };

    const recentDuplicate = await ScheduleRequest.findOne({
      status: 'pending',
      requesterEmail: requestData.requesterEmail,
      eventName: requestData.eventName,
      startDate: requestData.startDate,
      startTime: requestData.startTime,
      endDate: requestData.endDate,
      endTime: requestData.endTime,
      createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
    }).select('_id').lean();

    if (recentDuplicate) {
      return res.status(409).json({
        success: false,
        message: 'A matching schedule request was recently submitted.'
      });
    }

    const conflict = await findScheduleConflict(Schedule, req.body);
    if (conflict) {
      return res.status(409).json({
        success: false,
        message: 'The requested time range overlaps an existing confirmed schedule.'
      });
    }

    const storedFile = await storeUploadedFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      metadata: { purpose: 'schedule-request-attachment' },
    });
    storedFileReference = storedFile.reference;
    requestData.file = {
      filename: storedFile.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      storageKey: storedFile.reference,
    };
    
    const newRequest = new ScheduleRequest(requestData);
    await newRequest.save();
    
    res.status(201).json({
      success: true,
      message: 'Schedule request submitted successfully. Admin will review your request.',
      data: { id: newRequest._id, status: newRequest.status }
    });
  } catch (error) {
    if (storedFileReference) await deleteStoredUpload(storedFileReference).catch(() => {});
    if (error?.code === 10334 || /BSONObj size|document is larger than the maximum allowed size/i.test(error?.message || '')) {
      return res.status(413).json({
        success: false,
        message: 'The uploaded request letter is too large.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to submit schedule request'
    });
  }
};

exports.downloadScheduleRequestFile = async (req, res) => {
  try {
    const request = await ScheduleRequest.findById(req.params.id).select('file').lean();
    const storageKey = request?.file?.storageKey;
    if (!storageKey) return res.status(404).json({ success: false, message: 'File not found' });

    const streamed = await streamUploadFile(storageKey, res, {
      filename: request.file.originalname || 'request-letter',
      contentType: request.file.mimetype || 'application/octet-stream',
      fallbackFilename: request.file.filename,
    });
    if (!streamed) return res.status(404).json({ success: false, message: 'File not found' });
    return res;
  } catch (error) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
};

// Get all schedule requests
exports.getScheduleRequests = async (req, res) => {
  try {
    console.log('📋 ADMIN: Fetching schedule requests from MongoDB');
    
    const { status } = req.query;
    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    const requests = (await ScheduleRequest.find(filter)
      .sort({ createdAt: 1 }) // Ascending order (oldest first)
      .lean()).map(removeLegacyPathFromResponse);
    
    console.log(`✅ Retrieved ${requests.length} schedule requests from MongoDB`);
    
    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('❌ Error fetching schedule requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedule requests',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// Get a single schedule request by ID
exports.getScheduleRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await ScheduleRequest.findById(id);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Schedule request not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: removeLegacyPathFromResponse(request.toObject ? request.toObject() : request)
    });
  } catch (error) {
    console.error('Error fetching schedule request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedule request',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// Update schedule request status (approve/reject)
exports.updateScheduleRequest = async (req, res) => {
  let releaseLock;
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;
    
    console.log(`📝 ADMIN: Updating schedule request ${id} to status: ${status}`);
    
    // Validate status
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value. Must be: pending, approved, or rejected'
      });
    }
    
    const request = await ScheduleRequest.findById(id);
    if (!request) {
      console.log(`❌ Schedule request ${id} not found`);
      return res.status(404).json({
        success: false,
        message: 'Schedule request not found'
      });
    }

    if (request.status !== 'pending') {
      return res.status(409).json({
        success: false,
        message: `Schedule request has already been ${request.status}`
      });
    }

    if (status === 'approved') {
      releaseLock = await acquireScheduleConflictLock();
      const existingSchedule = await Schedule.findOne({ fromRequest: request._id });
      if (existingSchedule) {
        return res.status(200).json({
          success: true,
          message: 'Schedule request was already approved',
          data: {
            request: removeLegacyPathFromResponse(request.toObject ? request.toObject() : request),
            schedule: existingSchedule
          }
        });
      }

      const conflict = await findScheduleConflict(Schedule, request);
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: 'The requested time range overlaps an existing active schedule.'
        });
      }
    }

    const updateData = {
      status,
      reviewedAt: new Date(),
      updatedAt: new Date()
    };
    if (req.user && req.user._id) updateData.reviewedBy = req.user._id;
    if (status === 'rejected' && rejectionReason) updateData.rejectionReason = rejectionReason;
    
    console.log(`✅ Schedule request ${id} updated to ${status}`);
    
    // If approved, automatically create a schedule and sync to calendar
    if (status === 'approved') {
      try {
        console.log(`📅 Creating schedule from approved request ${id}`);
        
        const newSchedule = new Schedule({
          event: request.eventName,
          startDate: request.startDate,
          endDate: request.endDate,
          startTime: request.startTime,
          endTime: request.endTime,
          prepDays: request.prepDays || 0,
          organization: request.organization || '',
          purpose: request.purpose || '',
          details: request.details || '',
          status: 'active',
          fromRequest: request._id,
          createdBy: req.user ? req.user._id : null
        });
        
        await newSchedule.save();

        Object.assign(request, updateData);
        await request.save();
        
        console.log(`✅ Schedule created and saved to MongoDB: ${newSchedule._id}`);
        console.log(`✅ Schedule will be visible in both Admin and Public calendars`);
        
        return res.status(200).json({
          success: true,
          message: 'Schedule request approved and schedule created successfully',
          data: {
            request: removeLegacyPathFromResponse(request.toObject ? request.toObject() : request),
            schedule: newSchedule
          }
        });
      } catch (scheduleError) {
        console.error('❌ Error creating schedule from approved request:', scheduleError);
        return res.status(500).json({
          success: false,
          message: 'Schedule request could not be approved because calendar creation failed',
          message: 'An unexpected server error occurred. Please try again.'
        });
      }
    }

    Object.assign(request, updateData);
    await request.save();
    
    res.status(200).json({
      success: true,
      message: `Schedule request ${status} successfully`,
      data: removeLegacyPathFromResponse(request.toObject ? request.toObject() : request)
    });
  } catch (error) {
    console.error('❌ Error updating schedule request:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode === 503
        ? error.message
        : 'An unexpected server error occurred. Please try again.'
    });
  } finally {
    if (releaseLock) await releaseLock();
  }
};

// Delete a schedule request
exports.deleteScheduleRequest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        success: false,
        message: 'Schedule request not found'
      });
    }

    const deletedRequest = await ScheduleRequest.findOneAndDelete({
      _id: id,
      status: { $in: ['approved', 'rejected'] }
    });
    
    if (!deletedRequest) {
      return res.status(404).json({
        success: false,
        message: 'Schedule request not found'
      });
    }

    if (deletedRequest.file?.storageKey) {
      await deleteStoredUpload(deletedRequest.file.storageKey).catch((error) => {
        console.warn('Unable to remove stored schedule request attachment:', error.message);
      });
    }
    
    const deletedSchedule = deletedRequest.status === 'approved'
      ? await Schedule.findOneAndDelete({ fromRequest: deletedRequest._id })
      : null;

    res.status(200).json({
      success: true,
      message: 'Schedule request deleted successfully',
      data: {
        id: deletedRequest._id,
        scheduleDeleted: Boolean(deletedSchedule)
      }
    });
  } catch (error) {
    console.error('Error deleting schedule request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete schedule request',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// Get schedule requests by status
exports.getRequestsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status parameter'
      });
    }
    
    const requests = (await ScheduleRequest.find({ status })
      .sort({ createdAt: 1 })
      .lean()).map(removeLegacyPathFromResponse);
    
    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('Error fetching requests by status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requests',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};