// backend/routes/probationRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const ProbationTrackingService = require('../services/probationTrackingService');

// Middleware to check if user is admin or HR
const isAdminOrHr = (req, res, next) => {
    if (req.user.role === 'Admin' || req.user.role === 'HR') {
        next();
    } else {
        res.status(403).json({ error: 'Access denied. Admin or HR role required.' });
    }
};

// GET /api/probation/check-completions
// Manually trigger probation completion check (admin only)
router.get('/check-completions', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        await ProbationTrackingService.checkProbationCompletions();
        res.json({ message: 'Probation completion check completed successfully.' });
    } catch (error) {
        console.error('Error checking probation completions:', error);
        res.status(500).json({ error: 'Failed to check probation completions.' });
    }
});

// GET /api/probation/employee/:id/progress
// Get probation progress for a specific employee
router.get('/employee/:id/progress', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const { id } = req.params;
        const User = require('../models/User');
        
        const employee = await User.findById(id);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        if (employee.employmentStatus !== 'Probation') {
            return res.status(400).json({ error: 'Employee is not on probation.' });
        }
        
        const progress = await ProbationTrackingService.calculateProbationProgress(
            employee._id, 
            employee.joiningDate
        );
        
        res.json({
            employee: {
                id: employee._id,
                name: employee.fullName,
                employeeCode: employee.employeeCode,
                joiningDate: employee.joiningDate,
                employmentStatus: employee.employmentStatus
            },
            progress
        });
    } catch (error) {
        console.error('Error getting probation progress:', error);
        res.status(500).json({ error: 'Failed to get probation progress.' });
    }
});

// POST /api/probation/promote/:id
// Promote employee to permanent status
router.post('/promote/:id', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.user;
        
        const result = await ProbationTrackingService.promoteEmployeeToPermanent(id, userId);
        res.json(result);
    } catch (error) {
        console.error('Error promoting employee:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to promote employee to permanent status.' 
        });
    }
});

// GET /api/probation/employees
// Get all employees on probation with their progress
router.get('/employees', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const User = require('../models/User');
        
        const probationEmployees = await User.find({
            employmentStatus: 'Probation',
            isActive: true
        }).select('_id fullName employeeCode joiningDate email department designation');
        
        const employeesWithProgress = await Promise.all(
            probationEmployees.map(async (employee) => {
                try {
                    const progress = await ProbationTrackingService.calculateProbationProgress(
                        employee._id, 
                        employee.joiningDate
                    );
                    return {
                        employee: {
                            id: employee._id,
                            name: employee.fullName,
                            employeeCode: employee.employeeCode,
                            joiningDate: employee.joiningDate,
                            email: employee.email,
                            department: employee.department,
                            designation: employee.designation,
                            employmentStatus: employee.employmentStatus
                        },
                        progress
                    };
                } catch (error) {
                    console.error(`Error calculating progress for ${employee.fullName}:`, error);
                    return {
                        employee: {
                            id: employee._id,
                            name: employee.fullName,
                            employeeCode: employee.employeeCode,
                            joiningDate: employee.joiningDate,
                            email: employee.email,
                            department: employee.department,
                            designation: employee.designation,
                            employmentStatus: employee.employmentStatus
                        },
                        progress: null,
                        error: 'Failed to calculate progress'
                    };
                }
            })
        );
        
        res.json({ employees: employeesWithProgress });
    } catch (error) {
        console.error('Error getting probation employees:', error);
        res.status(500).json({ error: 'Failed to get probation employees.' });
    }
});

module.exports = router;
