module.exports = {
  apps: [{
    name: 'music-bot',
    script: 'dist/index.js',
    interpreter: 'C:\\Users\\carlo\\AppData\\Local\\nvm\\v24.12.0\\node.exe',
    watch: false,
    restart_delay: 3000,      // wait 3s before restarting after a crash
    max_restarts: 10,         // stop restarting if it crashes 10 times rapidly
    out_file: '.utilities/logs/out.log', 
    error_file: '.utilities/logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    env: {
      NODE_ENV: 'production',
    },
  }],
};