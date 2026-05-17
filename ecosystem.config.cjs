module.exports = {
  apps: [
    {
      name: 'stock-backend',
      script: 'c:/01coding/stock-game/backend/.venv/Scripts/python.exe',
      args: '-m uvicorn main:app --host 127.0.0.1 --port 8001',
      cwd: 'c:/01coding/stock-game/backend/server',
      interpreter: 'none',
      autorestart: true,
      watch: false,
      env: {
        PYTHONIOENCODING: 'utf-8',
      },
    },
  ],
}
