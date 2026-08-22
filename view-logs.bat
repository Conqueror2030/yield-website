@echo off
echo ============================================
echo   Yield.ai System Log Monitor (24/7)
echo ============================================
echo.
echo Opening live log streams...
echo.
echo Press Ctrl+C to stop monitoring.
echo.

powershell -Command "ssh -i ~/.ssh/gcp_key gcp-vps-deploy@34.24.209.173 'pm2 logs yield-engine yield-cron --lines 100'"

pause