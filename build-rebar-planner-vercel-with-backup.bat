@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "APP_NAME=rebar-planner"
set "BACKUP_DIR=C:\Users\vdumpa\backups\rebar-planner"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "TS=%%i"
set "BACKUP_FILE=%BACKUP_DIR%\rebar-planner-%TS%.zip"

echo.
echo =========================
echo Creating backup
echo =========================
echo Backup file: %BACKUP_FILE%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$ProgressPreference='SilentlyContinue';" ^
  "$src = Get-Location;" ^
  "$dest = '%BACKUP_FILE%';" ^
  "$tmpName = '_backup_stage_' + [guid]::NewGuid().ToString();" ^
  "$tmp = Join-Path $src $tmpName;" ^
  "New-Item -ItemType Directory -Path $tmp | Out-Null;" ^
  "$exclude = @('node_modules','.next','.turbo','out','dist','coverage','.git','.vercel','source-zips','rebar-planner-zips','backups',$tmpName);" ^
  "Get-ChildItem -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object { Copy-Item $_.FullName -Destination $tmp -Recurse -Force };" ^
  "$badDirs=@('node_modules','.next','.turbo','out','dist','coverage','.git','.vercel','.gradle','build','release','DerivedData','Pods','xcuserdata');" ^
  "Get-ChildItem $tmp -Recurse -Force -Directory | Where-Object { $badDirs -contains $_.Name } | Sort-Object FullName -Descending | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;" ^
  "Get-ChildItem $tmp -Recurse -Force -File | Where-Object { $_.Name -like '*.log' -or $_.Name -eq 'tsconfig.tsbuildinfo' -or $_.Extension -in '.aab','.apk','.ipa','.xcarchive' -or $_.Extension -in '.keystore','.jks' } | Remove-Item -Force -ErrorAction SilentlyContinue;" ^
  "Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $dest -Force;" ^
  "Remove-Item $tmp -Recurse -Force"

if errorlevel 1 (
  echo.
  echo ERROR: Backup failed.
  pause
  exit /b 1
)

echo Backup created successfully.
echo.

echo =========================
echo Clearing local build cache
echo =========================

if exist ".next" rmdir /s /q ".next"
if exist ".turbo" rmdir /s /q ".turbo"
if exist "node_modules\.cache" rmdir /s /q "node_modules\.cache"

echo Cache cleanup finished.
echo.

echo =========================
echo Running build check
echo =========================

call npm run build

if errorlevel 1 (
  echo.
  echo ERROR: Build failed.
  echo Your backup is in: %BACKUP_FILE%
  pause
  exit /b 1
)

echo.
echo =========================
echo Build Size Summary
echo =========================

for /f %%i in ('powershell -NoProfile -Command "[math]::Round(((Get-ChildItem '.next' -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)"') do set "NEXT_SIZE_MB=%%i"

echo Approximate deployed build size ^(.next^): %NEXT_SIZE_MB% MB

echo.
echo Largest files in .next:
powershell -NoProfile -Command ^
  "$files = Get-ChildItem '.next' -Recurse -File | Sort-Object Length -Descending | Select-Object -First 10 FullName,@{Name='SizeMB';Expression={[math]::Round($_.Length / 1MB, 2)}};" ^
  "if ($files) { $files | Format-Table -AutoSize } else { Write-Host 'No files found in .next' }"

echo.
echo =========================
echo Checking Vercel CLI
echo =========================

where vercel >nul 2>nul
if errorlevel 1 (
  echo ERROR: Vercel CLI is not installed.
  echo Run: npm i -g vercel
  pause
  exit /b 1
)

echo.
echo =========================
echo Deploying to Vercel Production
echo =========================

call vercel --prod

if errorlevel 1 (
  echo.
  echo ERROR: Vercel production deploy failed.
  echo Your backup is in: %BACKUP_FILE%
  pause
  exit /b 1
)

echo.
echo =========================
echo Production deploy completed
echo =========================
echo Backup saved to: %BACKUP_FILE%
echo.

pause
endlocal
