module.exports = {
  apps: [{
    name: 'traverse',
    script: 'build/index.js',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 2000,
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: 3456,
    },
  }],
};
