// /srv/webrtc_mini/app/ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "webrtc-mini",
      cwd: "/srv/webrtc_mini/app",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        MONGODB_URI:
          "mongodb://webrtc:webrtcpassword@127.0.0.1:27017/webrtcmini?authSource=webrtcmini",
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: "webrtc-ot",
      cwd: "/srv/webrtc_mini/app",
      script: "ot-server.js",
      env: {
        NODE_ENV: "production",
        OT_PORT: "3001",
        MONGODB_URI:
          "mongodb://webrtc:webrtcpassword@127.0.0.1:27017/webrtcmini?authSource=webrtcmini",
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
