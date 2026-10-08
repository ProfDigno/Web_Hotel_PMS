@echo off
setlocal
title PMS Hotelero
cd /d "%~dp0"
if not exist ".env" (
  echo No se encontro .env. Copialo desde .env.example y configura PostgreSQL.
  pause
  exit /b 1
)
echo Iniciando PMS: interfaz y API en un solo puerto.
echo La direccion se mostrara cuando el servidor este listo.
call npm.cmd run dev
if errorlevel 1 pause
endlocal
