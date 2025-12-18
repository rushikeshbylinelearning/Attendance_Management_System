// backend/routes/payrollRoutes.js

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');

/**
 * Payroll Routes - Placeholder Implementation
 * These routes provide basic structure for future payroll functionality
 * Currently returns dummy data for frontend testing
 */

// Middleware to check if user is Admin or HR
const checkAdminOrHR = (req, res, next) => {
    if (req.user.role !== 'Admin' && req.user.role !== 'HR') {
        return res.status(403).json({ 
            error: 'Access denied. Only Admin and HR roles can access payroll management.' 
        });
    }
    next();
};

/**
 * GET /api/payroll/settings
 * Get payroll configuration settings
 */
router.get('/settings', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        // Placeholder response - In production, fetch from database
        const settings = {
            basicPercentage: 40,
            hraPercentage: 20,
            allowancesPercentage: 15,
            pfPercentage: 12,
            esiPercentage: 0.75,
            professionalTax: 200,
            overtimeRate: 150,
            unpaidLeaveDeduction: 1000,
            tdsPercentage: 5,
            lastUpdated: new Date(),
            updatedBy: req.user.name
        };

        res.json({
            success: true,
            data: settings
        });
    } catch (error) {
        console.error('Error fetching payroll settings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch payroll settings',
            message: error.message 
        });
    }
});

/**
 * POST /api/payroll/settings
 * Update payroll configuration settings
 */
router.post('/settings', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        const {
            basicPercentage,
            hraPercentage,
            allowancesPercentage,
            pfPercentage,
            esiPercentage,
            professionalTax,
            overtimeRate,
            unpaidLeaveDeduction,
            tdsPercentage
        } = req.body;

        // Placeholder - In production, save to database
        const updatedSettings = {
            basicPercentage,
            hraPercentage,
            allowancesPercentage,
            pfPercentage,
            esiPercentage,
            professionalTax,
            overtimeRate,
            unpaidLeaveDeduction,
            tdsPercentage,
            lastUpdated: new Date(),
            updatedBy: req.user.name
        };

        res.json({
            success: true,
            message: 'Payroll settings updated successfully',
            data: updatedSettings
        });
    } catch (error) {
        console.error('Error updating payroll settings:', error);
        res.status(500).json({ 
            error: 'Failed to update payroll settings',
            message: error.message 
        });
    }
});

/**
 * GET /api/payroll/employees
 * Get all employees with their payroll information
 */
router.get('/employees', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        // Placeholder - In production, fetch from database with proper joins
        const employees = [
            {
                id: 'emp_001',
                name: 'John Doe',
                email: 'john.doe@example.com',
                department: 'Engineering',
                designation: 'Senior Developer',
                ctc: 1200000,
                basic: 480000,
                hra: 240000,
                allowances: 180000,
                grossPay: 900000,
                deductions: 150000,
                netPay: 750000,
                status: 'approved',
                overtimeHours: 0,
                unpaidLeaveDays: 0,
                bonus: 0
            },
            {
                id: 'emp_002',
                name: 'Jane Smith',
                email: 'jane.smith@example.com',
                department: 'Marketing',
                designation: 'Marketing Manager',
                ctc: 1000000,
                basic: 400000,
                hra: 200000,
                allowances: 150000,
                grossPay: 750000,
                deductions: 125000,
                netPay: 625000,
                status: 'pending',
                overtimeHours: 5,
                unpaidLeaveDays: 0,
                bonus: 10000
            }
        ];

        res.json({
            success: true,
            data: employees,
            count: employees.length
        });
    } catch (error) {
        console.error('Error fetching payroll employees:', error);
        res.status(500).json({ 
            error: 'Failed to fetch payroll employees',
            message: error.message 
        });
    }
});

/**
 * GET /api/payroll/employees/:id
 * Get specific employee payroll information
 */
router.get('/employees/:id', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        const { id } = req.params;

        // Placeholder - In production, fetch from database
        const employee = {
            id: id,
            name: 'Sample Employee',
            email: 'employee@example.com',
            department: 'General',
            designation: 'Employee',
            ctc: 600000,
            basic: 240000,
            hra: 120000,
            allowances: 90000,
            grossPay: 450000,
            deductions: 75000,
            netPay: 375000,
            status: 'pending',
            overtimeHours: 0,
            unpaidLeaveDays: 0,
            bonus: 0
        };

        res.json({
            success: true,
            data: employee
        });
    } catch (error) {
        console.error('Error fetching employee payroll:', error);
        res.status(500).json({ 
            error: 'Failed to fetch employee payroll',
            message: error.message 
        });
    }
});

/**
 * POST /api/payroll/employees
 * Add or update employee payroll information
 */
router.post('/employees', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        const employeeData = req.body;

        // Placeholder - In production, save to database
        const savedEmployee = {
            ...employeeData,
            id: employeeData.id || `emp_${Date.now()}`,
            lastUpdated: new Date(),
            updatedBy: req.user.name
        };

        res.json({
            success: true,
            message: 'Employee payroll saved successfully',
            data: savedEmployee
        });
    } catch (error) {
        console.error('Error saving employee payroll:', error);
        res.status(500).json({ 
            error: 'Failed to save employee payroll',
            message: error.message 
        });
    }
});

/**
 * PUT /api/payroll/employees/:id
 * Update specific employee payroll information
 */
router.put('/employees/:id', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        const { id } = req.params;
        const employeeData = req.body;

        // Placeholder - In production, update in database
        const updatedEmployee = {
            ...employeeData,
            id: id,
            lastUpdated: new Date(),
            updatedBy: req.user.name
        };

        res.json({
            success: true,
            message: 'Employee payroll updated successfully',
            data: updatedEmployee
        });
    } catch (error) {
        console.error('Error updating employee payroll:', error);
        res.status(500).json({ 
            error: 'Failed to update employee payroll',
            message: error.message 
        });
    }
});

/**
 * DELETE /api/payroll/employees/:id
 * Delete employee payroll information
 */
router.delete('/employees/:id', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        const { id } = req.params;

        // Placeholder - In production, delete from database
        res.json({
            success: true,
            message: 'Employee payroll deleted successfully',
            deletedId: id
        });
    } catch (error) {
        console.error('Error deleting employee payroll:', error);
        res.status(500).json({ 
            error: 'Failed to delete employee payroll',
            message: error.message 
        });
    }
});

/**
 * POST /api/payroll/generate
 * Generate payroll for a specific month
 */
router.post('/generate', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        const { month, year, employeeIds } = req.body;

        // Placeholder - In production, calculate based on attendance, leaves, etc.
        const generatedPayrolls = {
            month,
            year,
            totalEmployees: employeeIds?.length || 0,
            totalAmount: 0,
            status: 'pending',
            generatedBy: req.user.name,
            generatedAt: new Date()
        };

        res.json({
            success: true,
            message: 'Payroll generated successfully',
            data: generatedPayrolls
        });
    } catch (error) {
        console.error('Error generating payroll:', error);
        res.status(500).json({ 
            error: 'Failed to generate payroll',
            message: error.message 
        });
    }
});

/**
 * POST /api/payroll/approve/:id
 * Approve a payroll
 */
router.post('/approve/:id', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        const { id } = req.params;

        // Placeholder - In production, update status in database
        res.json({
            success: true,
            message: 'Payroll approved successfully',
            data: {
                id,
                status: 'approved',
                approvedBy: req.user.name,
                approvedAt: new Date()
            }
        });
    } catch (error) {
        console.error('Error approving payroll:', error);
        res.status(500).json({ 
            error: 'Failed to approve payroll',
            message: error.message 
        });
    }
});

/**
 * GET /api/payroll/statistics
 * Get payroll statistics and analytics
 */
router.get('/statistics', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        // Placeholder - In production, calculate from database
        const statistics = {
            totalEmployees: 50,
            totalSalaryExpense: 2500000,
            pendingPayrolls: 15,
            approvedPayrolls: 35,
            departmentWiseDistribution: [
                { department: 'Engineering', count: 20, totalSalary: 1200000 },
                { department: 'Marketing', count: 10, totalSalary: 500000 },
                { department: 'Sales', count: 15, totalSalary: 600000 },
                { department: 'HR', count: 5, totalSalary: 200000 }
            ],
            monthlyTrend: [
                { month: 'Jan', salary: 2300000 },
                { month: 'Feb', salary: 2400000 },
                { month: 'Mar', salary: 2500000 }
            ]
        };

        res.json({
            success: true,
            data: statistics
        });
    } catch (error) {
        console.error('Error fetching payroll statistics:', error);
        res.status(500).json({ 
            error: 'Failed to fetch payroll statistics',
            message: error.message 
        });
    }
});

/**
 * POST /api/payroll/calculate
 * Calculate salary for given parameters
 */
router.post('/calculate', authenticateToken, checkAdminOrHR, async (req, res) => {
    try {
        const { 
            ctc, 
            overtimeHours = 0, 
            unpaidLeaveDays = 0, 
            bonus = 0,
            settings 
        } = req.body;

        if (!ctc || !settings) {
            return res.status(400).json({
                error: 'CTC and settings are required'
            });
        }

        // Calculate salary components
        const basic = (ctc * settings.basicPercentage) / 100;
        const hra = (ctc * settings.hraPercentage) / 100;
        const allowances = (ctc * settings.allowancesPercentage) / 100;
        const grossPay = basic + hra + allowances;

        // Calculate deductions
        const pf = (basic * settings.pfPercentage) / 100;
        const esi = (grossPay * settings.esiPercentage) / 100;
        const tds = (grossPay * settings.tdsPercentage) / 100;
        const overtimePay = overtimeHours * settings.overtimeRate;
        const leaveDeduction = unpaidLeaveDays * settings.unpaidLeaveDeduction;

        const totalDeductions = pf + esi + settings.professionalTax + tds + leaveDeduction;
        const totalEarnings = grossPay + overtimePay + bonus;
        const netPay = totalEarnings - totalDeductions;

        res.json({
            success: true,
            data: {
                ctc,
                basic,
                hra,
                allowances,
                grossPay,
                pf,
                esi,
                professionalTax: settings.professionalTax,
                tds,
                overtimePay,
                leaveDeduction,
                bonus,
                totalDeductions,
                totalEarnings,
                netPay,
                monthlyNetPay: netPay / 12
            }
        });
    } catch (error) {
        console.error('Error calculating salary:', error);
        res.status(500).json({ 
            error: 'Failed to calculate salary',
            message: error.message 
        });
    }
});

module.exports = router;


