@echo off
title KKWIND Offline Exam Server
echo ========================================================
echo Starting KKWIND Offline LAN Exam Server...
echo ========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0run_lan_server.ps1"
pause