const ExcelJS = require('exceljs');
const path = require('path');

async function generateAttendanceExcel(data) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Attendance Log');

  // Headers
  sheet.addRow(['User ID', 'Action', 'Timestamp']);

  // Data rows
  data.forEach(row => {
    sheet.addRow(row);
  });

  // Save to public folder so it’s downloadable
  const filePath = path.join(__dirname, '../../public/attendance.xlsx');
  await workbook.xlsx.writeFile(filePath);
  console.log('Excel regenerated:', filePath);
}

module.exports = { generateAttendanceExcel };
