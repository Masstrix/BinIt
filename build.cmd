@echo off
rem Builds TimeTrial and puts the installer, the standalone exe and a README in .\dist
rem Double-click this, or run it from a terminal.  Options:
rem   build.cmd -SkipInstaller   only the standalone exe (quicker)
rem   build.cmd -SkipTests       don't run the tests first
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build.ps1" %*
set code=%errorlevel%
if "%~1"=="" pause
exit /b %code%
