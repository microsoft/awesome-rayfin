@echo off
rem Caldova Cologne Digital Twin - start locally without a network (venue fallback)
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stage-offline.ps1" %*
