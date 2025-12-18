// Input validation middleware using express-validator
const { body, param, query, validationResult } = require('express-validator');
const { logError } = require('../utils/logger');

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));

    logError(new Error('Validation failed'), {
      errors: errorMessages,
      body: req.body,
      params: req.params,
      query: req.query
    });

    return res.status(400).json({
      error: 'Validation failed',
      details: errorMessages
    });
  }
  next();
};

// Authentication validation
const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  handleValidationErrors
];

// User creation validation
const validateUserCreation = [
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, and number'),
  body('role')
    .isIn(['Admin', 'HR', 'Employee', 'Intern'])
    .withMessage('Role must be Admin, HR, Employee, or Intern'),
  body('employeeCode')
    .optional()
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Employee code must be between 3 and 20 characters'),
  handleValidationErrors
];

// Attendance validation
const validateAttendance = [
  body('attendanceDate')
    .isISO8601()
    .withMessage('Please provide a valid date'),
  body('sessions')
    .isArray({ min: 1 })
    .withMessage('At least one session is required'),
  body('sessions.*.startTime')
    .isISO8601()
    .withMessage('Session start time must be a valid date'),
  body('sessions.*.endTime')
    .optional()
    .isISO8601()
    .withMessage('Session end time must be a valid date'),
  handleValidationErrors
];

// Leave request validation
const validateLeaveRequest = [
  body('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  body('endDate')
    .isISO8601()
    .withMessage('End date must be a valid date'),
  body('reason')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Reason must be between 10 and 500 characters'),
  body('leaveType')
    .isIn(['Sick', 'Personal', 'Vacation', 'Emergency', 'Other'])
    .withMessage('Leave type must be one of: Sick, Personal, Vacation, Emergency, Other'),
  handleValidationErrors
];

// Break request validation
const validateBreakRequest = [
  body('startTime')
    .isISO8601()
    .withMessage('Start time must be a valid date'),
  body('endTime')
    .optional()
    .isISO8601()
    .withMessage('End time must be a valid date'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Reason must not exceed 200 characters'),
  handleValidationErrors
];

// Office location validation
const validateOfficeLocation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Office name must be between 2 and 100 characters'),
  body('address')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Address must be between 10 and 500 characters'),
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('radius')
    .isInt({ min: 10, max: 1000 })
    .withMessage('Radius must be between 10 and 1000 meters'),
  handleValidationErrors
];

// MongoDB ObjectId validation
const validateObjectId = (paramName) => [
  param(paramName)
    .isMongoId()
    .withMessage(`${paramName} must be a valid MongoDB ObjectId`),
  handleValidationErrors
];

// Pagination validation
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

// Date range validation
const validateDateRange = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid date'),
  handleValidationErrors
];

// Sanitize input helper
const sanitizeInput = (req, res, next) => {
  // Remove any potential XSS attempts
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  };

  // Recursively sanitize object
  const sanitizeObject = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return sanitizeString(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeObject(value);
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

module.exports = {
  validateLogin,
  validateUserCreation,
  validateAttendance,
  validateLeaveRequest,
  validateBreakRequest,
  validateOfficeLocation,
  validateObjectId,
  validatePagination,
  validateDateRange,
  sanitizeInput,
  handleValidationErrors
};








