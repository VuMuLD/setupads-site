module.exports = {
  apps: [
    {
      name: "setupads",
      cwd: "/home/setupads.site/public_html/apps/web",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        AUTH_TRUST_HOST: "true",
        NEXTAUTH_URL: "https://setupads.site",
      },
      error_file: "/home/setupads.site/logs/pm2-error.log",
      out_file: "/home/setupads.site/logs/pm2-out.log",
      max_memory_restart: "512M",
      autorestart: true,
    },
    {
      name: "setupads-ai",
      cwd: "/home/setupads.site/public_html/apps/ai-service",
      script: "venv/bin/uvicorn",
      args: "main:app --host 127.0.0.1 --port 8001",
      interpreter: "none",
      env: {
        PYTHONUNBUFFERED: "1",
      },
      error_file: "/home/setupads.site/logs/pm2-ai-error.log",
      out_file: "/home/setupads.site/logs/pm2-ai-out.log",
      max_memory_restart: "256M",
      autorestart: true,
    },
  ],
};
