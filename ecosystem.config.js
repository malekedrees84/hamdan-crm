module.exports = {
  apps: [
    {
      name: 'hamdan-server',
      script: 'server.js',
      cwd: '/Users/malekedrees/Desktop/٨٨٨٨',
      restart_delay: 5000,
      max_restarts: 50,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'hamdan-ngrok',
      script: '/opt/homebrew/bin/ngrok',
      interpreter: 'none',
      args: 'http 3000 --log=stdout',
      cwd: '/Users/malekedrees/Desktop/٨٨٨٨',
      restart_delay: 3000,
      max_restarts: 50,
    },
  ],
};
