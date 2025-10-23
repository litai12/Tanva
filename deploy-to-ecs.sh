#!/bin/bash
#
# Tanva Complete ECS Deployment Script
# This script automates the entire deployment process from scratch
# Run with: bash deploy-to-ecs.sh
#
# Prerequisites:
# 1. SSH access to your Aliyun ECS server
# 2. ECS server with Ubuntu 22.04 LTS or similar Linux distribution
# 3. Public IP address of the ECS server
#

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Tanva ECS Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"

# Configuration variables
export DEBIAN_FRONTEND=noninteractive
NODE_VERSION="20"
POSTGRES_VERSION="15"
DB_NAME="tanva"
DB_USER="tanva_user"
DB_PASSWORD="$(openssl rand -base64 32)"  # Generate strong password
APP_DIR="/home/ubuntu/tanva"
APP_USER="ubuntu"

echo -e "${YELLOW}[1/10] Updating system packages...${NC}"
sudo apt-get update
sudo apt-get upgrade -y

echo -e "${YELLOW}[2/10] Installing Node.js ${NODE_VERSION}...${NC}"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
sudo apt-get install -y nodejs

echo -e "${YELLOW}[3/10] Installing PostgreSQL ${POSTGRES_VERSION}...${NC}"
sudo apt-get install -y postgresql postgresql-contrib

echo -e "${YELLOW}[4/10] Configuring PostgreSQL...${NC}"
sudo -u postgres psql <<EOF
CREATE DATABASE ${DB_NAME};
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
ALTER ROLE ${DB_USER} SET client_encoding TO 'utf8';
ALTER ROLE ${DB_USER} SET default_transaction_isolation TO 'read committed';
ALTER ROLE ${DB_USER} SET default_transaction_deferrable TO on;
ALTER ROLE ${DB_USER} SET default_transaction_readonly TO off;
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
GRANT USAGE ON SCHEMA public TO ${DB_USER};
GRANT CREATE ON SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};
EOF

echo -e "${YELLOW}[5/10] Installing Nginx and PM2...${NC}"
sudo apt-get install -y nginx
sudo npm install -g pm2

echo -e "${YELLOW}[6/10] Creating application directory...${NC}"
sudo mkdir -p ${APP_DIR}
sudo chown -R ${APP_USER}:${APP_USER} ${APP_DIR}

echo -e "${YELLOW}[7/10] Cloning and building application...${NC}"
cd ${APP_DIR}

# Clone the repository (you may need to adjust the URL)
if [ ! -d ".git" ]; then
  # Clone from GitHub or your Git repository
  # Replace this with your actual repository URL
  git clone https://github.com/your-org/tanva.git .
else
  git pull origin main
fi

# Install dependencies
npm install

# Build the application
npm run build

echo -e "${YELLOW}[8/10] Setting up environment files...${NC}"

# Create production environment file for server
cat > ${APP_DIR}/server/.env.production <<ENVFILE
PORT=4000
HOST=0.0.0.0
NODE_ENV=production
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"
CORS_ORIGIN=https://your-domain.com,https://www.your-domain.com
DEFAULT_AI_PROVIDER=gemini
GOOGLE_GEMINI_API_KEY=your_gemini_api_key_here
LOG_LEVEL=info
ENVFILE

# Create production environment file for frontend
cat > ${APP_DIR}/.env.production <<ENVFILE
VITE_AI_LANGUAGE=zh
VITE_AUTH_MODE=server
VITE_API_BASE=https://your-domain.com/api
VITE_API_URL=https://your-domain.com
ENVFILE

echo -e "${YELLOW}⚠️  Please update environment variables:${NC}"
echo -e "${YELLOW}  - GOOGLE_GEMINI_API_KEY in server/.env.production${NC}"
echo -e "${YELLOW}  - your-domain.com in both .env files${NC}"
echo -e "${YELLOW}  - DATABASE_PASSWORD: ${DB_PASSWORD}${NC}"

echo -e "${YELLOW}[9/10] Setting up Nginx reverse proxy...${NC}"

# Create Nginx configuration
sudo tee /etc/nginx/sites-available/tanva > /dev/null <<'NGINXCONF'
upstream tanva_backend {
    server localhost:4000;
}

server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com www.your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL certificates (update with your certificate paths)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 100M;

    # Frontend static files
    location / {
        root /home/ubuntu/tanva/dist;
        try_files $uri $uri/ /index.html;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # API requests
    location /api/ {
        proxy_pass http://tanva_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://tanva_backend;
        access_log off;
    }
}
NGINXCONF

# Enable Nginx site
sudo ln -sf /etc/nginx/sites-available/tanva /etc/nginx/sites-enabled/tanva
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

echo -e "${YELLOW}[10/10] Starting services with PM2...${NC}"

# Create PM2 ecosystem configuration
cat > ${APP_DIR}/ecosystem.config.js <<'PMFILE'
module.exports = {
  apps: [
    {
      name: 'tanva-server',
      script: './dist/main.js',
      cwd: '/home/ubuntu/tanva/server',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '500M',
    }
  ]
};
PMFILE

# Create logs directory
mkdir -p ${APP_DIR}/server/logs

# Start application with PM2
cd ${APP_DIR}/server
pm2 start /home/ubuntu/tanva/ecosystem.config.js
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ${APP_USER} --hp /home/${APP_USER}

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Configuration Complete!${NC}"
echo -e "${GREEN}========================================${NC}"

echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo ""
echo "1. Update environment variables:"
echo "   sudo nano /home/ubuntu/tanva/server/.env.production"
echo "   - Add your GOOGLE_GEMINI_API_KEY"
echo "   - Update domain names (your-domain.com)"
echo ""
echo "2. Update Nginx configuration:"
echo "   sudo nano /etc/nginx/sites-available/tanva"
echo "   - Replace 'your-domain.com' with your actual domain"
echo "   - Update SSL certificate paths when ready"
echo ""
echo "3. Start Nginx:"
echo "   sudo systemctl start nginx"
echo "   sudo systemctl enable nginx"
echo ""
echo "4. Run database migrations (if using Prisma):"
echo "   cd /home/ubuntu/tanva/server"
echo "   npx prisma migrate deploy"
echo ""
echo "5. Setup SSL certificates with Let's Encrypt:"
echo "   sudo apt-get install -y certbot python3-certbot-nginx"
echo "   sudo certbot certonly --nginx -d your-domain.com -d www.your-domain.com"
echo ""
echo "6. Verify services are running:"
echo "   pm2 status"
echo "   sudo systemctl status nginx"
echo ""
echo "7. Update DNS records to point to your ECS public IP:"
echo "   Add A records for your-domain.com and www.your-domain.com"
echo ""
echo -e "${GREEN}Database credentials:${NC}"
echo "  Database: ${DB_NAME}"
echo "  User: ${DB_USER}"
echo "  Password: ${DB_PASSWORD}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Save the database password securely!${NC}"
echo ""
