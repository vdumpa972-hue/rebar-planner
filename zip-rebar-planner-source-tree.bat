@echo off
setlocal EnableExtensions

REM ============================================================
REM Rebar Planner SOURCE-ONLY export
REM Goal: include ONLY what is needed to rebuild/run the app.
REM Root files are copied by pattern: *.json, *.ts, *.yaml, etc.
REM Generated/rebuildable outputs are excluded/removed.
REM ============================================================

cd /d "%~dp0"

if not exist "package.json" (
  echo ERROR: package.json not found.
  echo Run this BAT from the Rebar Planner project root folder.
  pause
  exit /b 1
)

set "OUTDIR=%~dp0..\rebar-planner-zips"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "TS=%%i"
set "ZIPFILE=%OUTDIR%\rebar-planner-source-only-%TS%.zip"
set "STAGE=%TEMP%\rebar_source_export_%RANDOM%%RANDOM%"

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"

REM ============================================================
REM 1) Copy root rebuild/config/runtime files by pattern
REM ============================================================
for %%P in (
  *.json
  *.js
  *.mjs
  *.cjs
  *.ts
  *.tsx
  *.yaml
  *.yml
  *.md
  *.bat
  *.cmd
  *.ps1
  .env
  .env.*
  .eslintrc
  .eslintrc.*
  .prettierrc
  .prettierrc.*
  firestore.rules
) do (
  for %%F in (%%P) do (
    if exist "%%F" copy /y "%%F" "%STAGE%\" >nul
  )
)

REM ============================================================
REM 2) Copy source folders only
REM ============================================================
for %%D in (
  src
  app
  pages
  components
  lib
  hooks
  types
  utils
  contexts
  public
  styles
  prisma
  firebase
  scripts
) do (
  if exist "%%D" (
    robocopy "%%D" "%STAGE%\%%D" /E /NFL /NDL /NJH /NJS /NP ^
      /XD node_modules .next .turbo out dist coverage .git .vercel build release .gradle >nul
  )
)

REM ============================================================
REM 3) Android source/config only
REM ============================================================
if exist "android" (
  mkdir "%STAGE%\android" >nul 2>nul

  for %%F in (
    android\*.gradle
    android\*.properties
    android\gradlew
    android\gradlew.bat
    android\settings.gradle
  ) do (
    if exist "%%F" copy /y "%%F" "%STAGE%\android\" >nul
  )

  if exist "android\gradle\wrapper" (
    robocopy "android\gradle\wrapper" "%STAGE%\android\gradle\wrapper" /E /NFL /NDL /NJH /NJS /NP >nul
  )

  if exist "android\app" (
    mkdir "%STAGE%\android\app" >nul 2>nul

    for %%F in (
      android\app\*.gradle
      android\app\*.json
      android\app\*.pro
      android\app\*.properties
    ) do (
      if exist "%%F" copy /y "%%F" "%STAGE%\android\app\" >nul
    )

    if exist "android\app\src" (
      robocopy "android\app\src" "%STAGE%\android\app\src" /E /NFL /NDL /NJH /NJS /NP ^
        /XD assets build release .gradle >nul
    )
  )
)

REM ============================================================
REM 4) iOS source/config only
REM ============================================================
if exist "ios" (
  mkdir "%STAGE%\ios" >nul 2>nul

  if exist "ios\App" (
    mkdir "%STAGE%\ios\App" >nul 2>nul

    for %%F in (
      ios\App\Podfile
      ios\App\Podfile.lock
      ios\App\*.plist
      ios\App\*.entitlements
      ios\App\*.xcconfig
    ) do (
      if exist "%%F" copy /y "%%F" "%STAGE%\ios\App\" >nul
    )

    if exist "ios\App\App" (
      robocopy "ios\App\App" "%STAGE%\ios\App\App" /E /NFL /NDL /NJH /NJS /NP ^
        /XD public build DerivedData Pods >nul
    )

    if exist "ios\App\App.xcodeproj" (
      robocopy "ios\App\App.xcodeproj" "%STAGE%\ios\App\App.xcodeproj" /E /NFL /NDL /NJH /NJS /NP ^
        /XD xcuserdata project.xcworkspace >nul
    )

    if exist "ios\App\App.xcworkspace\contents.xcworkspacedata" (
      mkdir "%STAGE%\ios\App\App.xcworkspace" >nul 2>nul
      copy /y "ios\App\App.xcworkspace\contents.xcworkspacedata" "%STAGE%\ios\App\App.xcworkspace\" >nul
    )
  )
)

REM ============================================================
REM 5) Remove generated/rebuildable junk if anything slipped in
REM ============================================================
if exist "%STAGE%\Users" rmdir /s /q "%STAGE%\Users" >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$stage='%STAGE%';" ^
  "$badDirs=@('node_modules','.next','.turbo','out','dist','coverage','.git','.vercel','.gradle','build','release','DerivedData','Pods','xcuserdata');" ^
  "Get-ChildItem $stage -Recurse -Force -Directory | Where-Object { $badDirs -contains $_.Name } | Sort-Object FullName -Descending | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;" ^
  "Get-ChildItem $stage -Recurse -Force -File | Where-Object { $_.Name -like '*.log' -or $_.Name -eq 'tsconfig.tsbuildinfo' -or $_.Extension -in '.aab','.apk','.ipa','.xcarchive' } | Remove-Item -Force -ErrorAction SilentlyContinue;"

REM ============================================================
REM 6) Create flat-root ZIP from inside staging folder
REM ============================================================
if exist "%ZIPFILE%" del "%ZIPFILE%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$stage='%STAGE%';" ^
  "$zip='%ZIPFILE%';" ^
  "Push-Location $stage;" ^
  "Compress-Archive -Path * -DestinationPath $zip -Force;" ^
  "Pop-Location;"

set "ERR=%ERRORLEVEL%"
rmdir /s /q "%STAGE%" >nul 2>nul

if not "%ERR%"=="0" (
  echo.
  echo EXPORT FAILED.
  pause
  exit /b %ERR%
)

echo.
echo ZIP CREATED:
echo %ZIPFILE%
echo.
echo ZIP root should contain package.json, src, public, android, ios directly.
echo It should NOT contain Users, node_modules, .next, build, release, .aab, .apk, .ipa, Pods, or .gradle.
echo.
pause
endlocal
