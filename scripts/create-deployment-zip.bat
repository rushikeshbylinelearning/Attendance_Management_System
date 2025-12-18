@echo off
REM Windows batch script to create deployment zip files

echo ================================
echo Creating Deployment Packages
echo ================================
echo.

REM Set variables
set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..
set TIMESTAMP=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%

echo Starting deployment package creation...
echo.

REM Check if PowerShell is available
where powershell >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: PowerShell is required but not found
    echo Please install PowerShell to use this script
    pause
    exit /b 1
)

REM Create temp directory for deployment files
set TEMP_DIR=%ROOT_DIR%\deploy-temp
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

echo Step 1: Preparing backend files...
echo ================================
xcopy "%ROOT_DIR%\backend" "%TEMP_DIR%\backend\" /E /I /EXCLUDE:%SCRIPT_DIR%exclude-backend.txt
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Some backend files may not have been copied
)
echo Backend files prepared.
echo.

echo Step 2: Preparing frontend dist files...
echo ================================
if not exist "%ROOT_DIR%\frontend\dist" (
    echo ERROR: frontend/dist not found!
    echo Please run 'npm run build' in the frontend directory first
    pause
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

xcopy "%ROOT_DIR%\frontend\dist" "%TEMP_DIR%\backend\frontend-dist\" /E /I
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy frontend dist files
    pause
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)
echo Frontend dist files prepared.
echo.

echo Step 3: Creating .env.example file...
echo ================================
(
echo # Production Environment Variables
echo # Copy this to .env and fill in your values
echo.
echo NODE_ENV=production
echo PORT=3001
echo.
echo # Database
echo MONGODB_URI=your_mongodb_connection_string_here
echo.
echo # Security
echo JWT_SECRET=your_secure_jwt_secret_here
echo SESSION_SECRET=your_secure_session_secret_here
echo.
echo # Application URL
echo FRONTEND_URL=https://yourdomain.com
echo.
echo # Email Configuration ^(Optional^)
echo MAIL_HOST=
echo MAIL_PORT=
echo MAIL_USER=
echo MAIL_PASS=
echo MAIL_FROM=
echo.
echo # SSO Configuration ^(Optional^)
echo SSO_ENABLED=false
) > "%TEMP_DIR%\backend\.env.example"
echo .env.example created.
echo.

echo Step 4: Creating deployment instructions...
echo ================================
(
echo DEPLOYMENT INSTRUCTIONS FOR A2 HOSTING
echo ======================================
echo.
echo 1. Upload this entire 'backend' folder to your A2 hosting account
echo.
echo 2. SSH into your server and navigate to the backend folder
echo.
echo 3. Copy .env.example to .env and configure your environment variables:
echo    cp .env.example .env
echo    nano .env
echo.
echo 4. Install dependencies:
echo    npm install --production
echo.
echo 5. Create required directories:
echo    mkdir -p uploads/avatars
echo    mkdir -p public/reports
echo    mkdir -p logs
echo.
echo 6. Set proper permissions:
echo    chmod 755 uploads
echo    chmod 755 public
echo.
echo 7. Update server.js if needed:
echo    - The frontend dist files are in ./frontend-dist/
echo    - Update path if different from ../frontend/dist
echo.
echo 8. Start the application:
echo    node server.js
echo.
echo    OR use PM2 ^(recommended^):
echo    pm2 start server.js --name attendance-system
echo    pm2 save
echo    pm2 startup
echo.
echo 9. Verify deployment:
echo    - Visit your domain
echo    - Check /health endpoint
echo    - Test functionality
echo.
echo For more details, see DEPLOYMENT_CHECKLIST.txt
) > "%TEMP_DIR%\backend\DEPLOY_README.txt"
echo Deployment instructions created.
echo.

echo Step 5: Creating ZIP archive...
echo ================================

set OUTPUT_ZIP=%ROOT_DIR%\attendance-system-deploy-%TIMESTAMP%.zip

REM Use PowerShell to create zip
powershell -Command "Compress-Archive -Path '%TEMP_DIR%\backend\*' -DestinationPath '%OUTPUT_ZIP%' -Force"

if %ERRORLEVEL% EQ 0 (
    echo.
    echo ================================
    echo SUCCESS! Deployment package created:
    echo %OUTPUT_ZIP%
    echo ================================
    echo.
    echo Size:
    powershell -Command "Get-Item '%OUTPUT_ZIP%' | Select-Object @{Name='Size (MB)';Expression={[math]::Round($_.Length / 1MB, 2)}}"
    echo.
    echo Next steps:
    echo 1. Upload this ZIP to your A2 hosting account
    echo 2. Extract the contents
    echo 3. Follow the DEPLOY_README.txt instructions
    echo.
) else (
    echo ERROR: Failed to create ZIP archive
    pause
    rmdir /s /q "%TEMP_DIR%"
    exit /b 1
)

REM Cleanup
echo Cleaning up temporary files...
rmdir /s /q "%TEMP_DIR%"

echo.
echo Done!
echo.
pause


