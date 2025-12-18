#!/bin/bash
# Linux/Mac script to create deployment zip files

echo "================================"
echo "Creating Deployment Packages"
echo "================================"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo "Starting deployment package creation..."
echo ""

# Create temp directory for deployment files
TEMP_DIR="$ROOT_DIR/deploy-temp"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

echo "Step 1: Preparing backend files..."
echo "================================"

# Copy backend files excluding unwanted items
rsync -av --exclude-from="$SCRIPT_DIR/exclude-backend.txt" \
    "$ROOT_DIR/backend/" "$TEMP_DIR/backend/" \
    || { echo "WARNING: Some backend files may not have been copied"; }

echo "Backend files prepared."
echo ""

echo "Step 2: Preparing frontend dist files..."
echo "================================"

if [ ! -d "$ROOT_DIR/frontend/dist" ]; then
    echo "ERROR: frontend/dist not found!"
    echo "Please run 'npm run build' in the frontend directory first"
    rm -rf "$TEMP_DIR"
    exit 1
fi

mkdir -p "$TEMP_DIR/backend/frontend-dist"
cp -r "$ROOT_DIR/frontend/dist/"* "$TEMP_DIR/backend/frontend-dist/" \
    || { echo "ERROR: Failed to copy frontend dist files"; rm -rf "$TEMP_DIR"; exit 1; }

echo "Frontend dist files prepared."
echo ""

echo "Step 3: Creating .env.example file..."
echo "================================"

cat > "$TEMP_DIR/backend/.env.example" << 'EOF'
# Production Environment Variables
# Copy this to .env and fill in your values

NODE_ENV=production
PORT=3001

# Database
MONGODB_URI=your_mongodb_connection_string_here

# Security
JWT_SECRET=your_secure_jwt_secret_here
SESSION_SECRET=your_secure_session_secret_here

# Application URL
FRONTEND_URL=https://yourdomain.com

# Email Configuration (Optional)
MAIL_HOST=
MAIL_PORT=
MAIL_USER=
MAIL_PASS=
MAIL_FROM=

# SSO Configuration (Optional)
SSO_ENABLED=false
EOF

echo ".env.example created."
echo ""

echo "Step 4: Creating deployment instructions..."
echo "================================"

cat > "$TEMP_DIR/backend/DEPLOY_README.txt" << 'EOF'
DEPLOYMENT INSTRUCTIONS FOR A2 HOSTING
======================================

1. Upload this entire 'backend' folder to your A2 hosting account

2. SSH into your server and navigate to the backend folder

3. Copy .env.example to .env and configure your environment variables:
   cp .env.example .env
   nano .env

4. Install dependencies:
   npm install --production

5. Create required directories:
   mkdir -p uploads/avatars
   mkdir -p public/reports
   mkdir -p logs

6. Set proper permissions:
   chmod 755 uploads
   chmod 755 public

7. Update server.js if needed:
   - The frontend dist files are in ./frontend-dist/
   - Update path if different from ../frontend/dist

8. Start the application:
   node server.js

   OR use PM2 (recommended):
   pm2 start server.js --name attendance-system
   pm2 save
   pm2 startup

9. Verify deployment:
   - Visit your domain
   - Check /health endpoint
   - Test functionality

For more details, see DEPLOYMENT_CHECKLIST.txt
EOF

echo "Deployment instructions created."
echo ""

echo "Step 5: Creating ZIP archive..."
echo "================================"

OUTPUT_ZIP="$ROOT_DIR/attendance-system-deploy-$TIMESTAMP.zip"

cd "$TEMP_DIR/backend" || exit 1
zip -r "$OUTPUT_ZIP" . -x "*.git/*" "node_modules/*" "*.DS_Store" \
    || { echo "ERROR: Failed to create ZIP archive"; cd "$ROOT_DIR"; rm -rf "$TEMP_DIR"; exit 1; }

cd "$ROOT_DIR" || exit 1

if [ -f "$OUTPUT_ZIP" ]; then
    echo ""
    echo "================================"
    echo "SUCCESS! Deployment package created:"
    echo "$OUTPUT_ZIP"
    echo "================================"
    echo ""
    echo "Size: $(du -h "$OUTPUT_ZIP" | cut -f1)"
    echo ""
    echo "Next steps:"
    echo "1. Upload this ZIP to your A2 hosting account"
    echo "2. Extract the contents"
    echo "3. Follow the DEPLOY_README.txt instructions"
    echo ""
else
    echo "ERROR: Failed to create ZIP archive"
    rm -rf "$TEMP_DIR"
    exit 1
fi

# Cleanup
echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

echo ""
echo "Done!"
echo ""


