module.exports = {
  "apps": [
    {
      "name": "vinted-discord-bot",
      "script": "index.js",
      "instances": 1,
      "exec_mode": "fork",
      "max_memory_restart": "512M",
      "error_file": "logs/error.log",
      "out_file": "logs/out.log",
      "log_file": "logs/combined.log",
      "time": true,
      "env": {
        "NODE_ENV": "production"
      },
      "env_development": {
        "NODE_ENV": "development"
      }
    }
  ]
};