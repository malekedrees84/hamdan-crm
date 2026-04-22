const { execSync } = require('child_process');
const path = require('path');

// מצא את ngrok אוטומטית בכל מכונה
let ngrokPath = 'ngrok';
try { ngrokPath = execSync('which ngrok').toString().trim(); } catch {}

module.exports = {
  apps: [
    {
      name: 'hamdan-server',
      script: 'server.js',
      cwd: path.join(__dirname),
      restart_delay: 5000,
      max_restarts: 50,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'hamdan-ngrok',
      script: ngrokPath,
      interpreter: 'none',
      args: 'http 3000 --log=stdout',
      cwd: path.join(__dirname),
      restart_delay: 3000,
      max_restarts: 50,
    },
  ],
};
