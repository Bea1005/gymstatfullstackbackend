const ScheduleRequest = require('../models/ScheduleRequest');
const Schedule = require('../models/Schedule');
const mongoose = require('mongoose');
const path = require('path');
const { findScheduleConflict } = require('../utils/scheduleConflicts');
const { acquireScheduleConflictLock } = require('../utils/withScheduleConflictLock');
const { getScheduleClientType } = require('../utils/scheduleClientType');
const { sendScheduleRequestStatusEmail } = require('../config/email');
const {
  storeUploadedFile,
  deleteStoredUpload,
  streamUploadFile,
  removeLegacyPathFromResponse,
} = require('../config/uploadedFileStorage');

const isValidCalendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const notifyScheduleRequester = async (request, status) => {
  try {
    await sendScheduleRequestStatusEmail(request.requesterEmail, request, status);
    return true;
  } catch (error) {
    console.error('Unable to send schedule request status notification:', {
      requestId: String(request._id),
      status,
      code: error?.code || 'EMAIL_DELIVERY_FAILED'
    });
    return false;
  }
};

exports.getPublicCalendarScheduleRequests = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate) || startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: 'A valid start date and end date are required'
      });
    }

    const rangeStart = new Date(`${startDate}T00:00:00.000Z`);
    const rangeEnd = new Date(`${endDate}T00:00:00.000Z`);
    const latestStart = new Date(rangeEnd);
    latestStart.setUTCDate(latestStart.getUTCDate() + 30);
    const latestStartDate = latestStart.toISOString().slice(0, 10);
    const requests = await ScheduleRequest.find({
      status: 'pending',
      startDate: { $lte: latestStartDate },
      endDate: { $gte: startDate }
    })
      .select('_id eventName requesterEmail startDate endDate startTime endTime prepDays status')
      .sort({ startDate: 1, startTime: 1 })
      .lean();

    const calendarRequests = requests
      .filter((request) => {
        const requestStart = new Date(`${request.startDate}T00:00:00.000Z`);
        const requestEnd = new Date(`${request.endDate}T00:00:00.000Z`);
        if (Number.isNaN(requestStart.getTime()) || Number.isNaN(requestEnd.getTime())) return false;
        const prepStart = new Date(requestStart);
        prepStart.setUTCDate(prepStart.getUTCDate() - (Number(request.prepDays) || 0));
        return requestEnd >= rangeStart && prepStart <= rangeEnd;
      })
      .map((request) => ({
        _id: request._id,
        eventName: request.eventName,
        startDate: request.startDate,
        endDate: request.endDate,
        startTime: request.startTime,
        endTime: request.endTime,
        prepDays: Number(request.prepDays) || 0,
        status: 'pending',
        clientType: getScheduleClientType(request.requesterEmail)
      }));

    return res.status(200).json({
      success: true,
      count: calendarRequests.length,
      data: calendarRequests
    });
  } catch (error) {
    console.error('Error fetching public calendar requests:', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

const isValidScheduleRequestFile = (file) => {
  if (!Buffer.isBuffer(file?.buffer)) return false;
  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  const fileTypes = new Map([
    ['.pdf', { mimeType: 'application/pdf', matches: (buffer) => buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-' }],
    ['.png', { mimeType: 'image/png', matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
    ['.jpg', { mimeType: 'image/jpeg', matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
    ['.jpeg', { mimeType: 'image/jpeg', matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ]);
  const type = fileTypes.get(extension);
  return Boolean(type && file.mimetype === type.mimeType && type.matches(file.buffer));
};

// Create a new schedule request
exports.createScheduleRequest = async (req, res) => {
  let storedFileReference;
  try {
    if (!isValidScheduleRequestFile(req.file)) {
      return res.status(400).json({
        success: false,
        message: 'Only valid PDF, PNG, and JPEG attachments are supported.'
      });
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
      data: {
        id: newRequest._id,
        status: newRequest.status,
        clientType: getScheduleClientType(newRequest.requesterEmail)
      }
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
    if (!storageKey && request?.file?.data) {
      const base64Data = request.file.data.replace(/^data:[^,]*,/, '');
      const fileBuffer = Buffer.from(base64Data, 'base64');
      if (!fileBuffer.length) return res.status(404).json({ success: false, message: 'File not found' });

      res.setHeader('Content-Type', request.file.mimetype || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.attachment(request.file.originalname || request.file.filename || 'request-letter').send(fileBuffer);
    }
    if (!storageKey) return res.status(404).json({ success: false, message: 'File not found' });

    const streamed = await streamUploadFile(storageKey, res, {
      filename: request.file.originalname || 'request-letter',
      contentType: request.file.mimetype || 'application/octet-stream',
      fallbackFilename: request.file.filename,
      disposition: 'inline',
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
      .select('-file.data')
      .sort({ createdAt: 1 })
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
      message: 'Failed to fetch schedule requests. Please try again.'
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
        const requesterNotified = await notifyScheduleRequester(request, status);
        
        console.log(`✅ Schedule created and saved to MongoDB: ${newSchedule._id}`);
        console.log(`✅ Schedule will be visible in both Admin and Public calendars`);
        
        return res.status(200).json({
          success: true,
          message: 'Schedule request approved and schedule created successfully',
          requesterNotified,
          data: {
            request: removeLegacyPathFromResponse(request.toObject ? request.toObject() : request),
            schedule: newSchedule
          }
        });
      } catch (scheduleError) {
        console.error('❌ Error creating schedule from approved request:', scheduleError);
        return res.status(500).json({
          success: false,
          message: 'Schedule request could not be approved because calendar creation failed.'
        });
      }
    }

    Object.assign(request, updateData);
    await request.save();
    const requesterNotified = ['approved', 'rejected'].includes(status)
      ? await notifyScheduleRequester(request, status)
      : undefined;
    
    res.status(200).json({
      success: true,
      message: `Schedule request ${status} successfully`,
      ...(requesterNotified === undefined ? {} : { requesterNotified }),
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

exports.isValidScheduleRequestFile = isValidScheduleRequestFile;