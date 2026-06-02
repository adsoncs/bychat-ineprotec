module.exports = {
  apps: [
    {
      name: 'bychat-ineprotec',
      script: '/usr/bin/bash',
      args: '-c "npx tsx --env-file=.env src/server.ts"',
      cwd: '/var/www/bychat-ineprotec/backend',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 3102,
      },
      error_file: '/var/log/pm2/bychat-ineprotec-error.log',
      out_file:   '/var/log/pm2/bychat-ineprotec-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
    }
  ]
}
