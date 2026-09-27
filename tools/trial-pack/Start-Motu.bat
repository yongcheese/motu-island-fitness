@echo off
setlocal
title Motu - Island Fitness
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this computer.
  echo   Please install Node.js LTS from https://nodejs.org/ and run this file again.
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

node "%~dp0runtime\serve.cjs"
echo.
echo   The server has stopped.
pause
