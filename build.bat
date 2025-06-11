@echo off
setlocal

:: =============================================================================
:: Universal Build Script for Photopea Desktop (v4 - Environment Fix)
:: Builds for Windows natively, then uses WSL for a clean Linux build.
:: =============================================================================

:: --- Configuration ---
set "LINUX_ARTIFACT_NAME=linux-builds.tar.gz"
:: --- IMPORTANT: Set your WSL distribution name here if it's not the default one.
:: --- Run 'wsl -l' to see available names (e.g., "Ubuntu-22.04").
:: --- Leave empty to use your default WSL distribution.
set "WSL_DISTRO="

:: --- Prerequisite Check ---
echo Checking for WSL installation...
wsl.exe -l -v > nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] WSL is not detected or is not running.
    echo Please install WSL and a Linux distribution ^(like Ubuntu^) from the Microsoft Store.
    echo You may also need to run 'wsl --install' or 'wsl --update' in PowerShell.
    exit /b 1
)
echo WSL detected.

:: =============================================================================
:: PHASE 1: BUILD FOR WINDOWS
:: =============================================================================
rem echo.
rem echo ===================================
rem echo  PHASE 1: BUILDING FOR WINDOWS
rem echo ===================================
rem echo.

rem echo Cleaning up previous Windows build directories...
rem if exist "out" rd /s /q out

rem echo Running 'npm install' for Windows platform...
rem call npm install
rem if %errorlevel% neq 0 (
rem     echo [ERROR] 'npm install' failed for Windows. Aborting.
rem     exit /b 1
rem )

rem echo Running 'npm run make' for Windows...
rem call npm run make
rem if %errorlevel% neq 0 (
rem     echo [ERROR] Windows build failed. Aborting.
rem     exit /b 1
rem )
rem echo Windows build successful! Installer is in the 'out\make' directory.

:: =============================================================================
:: PHASE 2: BUILD FOR LINUX (via WSL)
:: =============================================================================
echo.
echo ===================================
echo   PHASE 2: BUILDING FOR LINUX (via WSL)
echo ===================================
echo This will perform a clean build inside your WSL environment. This may take a while...
echo.

if defined WSL_DISTRO (
    set "WSL_EXEC=wsl.exe -d %WSL_DISTRO%"
) else (
    set "WSL_EXEC=wsl.exe"
)

for /f "delims=" %%i in ('%WSL_EXEC% wslpath -u "%cd%"') do set "WSL_PROJECT_DIR=%%i"

set "WSL_BUILD_DIR=/tmp/photopea-build-%RANDOM%"

:: --- THE FIX: Use 'env -i' to start with a clean environment and 'bash -lc' to run profile scripts (for nvm, etc.)
:: This prevents Windows environment variables (like PATH) from contaminating the Linux build process.
%WSL_EXEC% env -i bash -lc "set -e; echo '--- [WSL] Cleaning up previous build directories...'; rm -rf %WSL_BUILD_DIR%; mkdir -p %WSL_BUILD_DIR%; echo '--- [WSL] Copying project source files...'; rsync -a --info=progress2 \"%WSL_PROJECT_DIR%/\" \"%WSL_BUILD_DIR%/\" --exclude node_modules --exclude out; cd %WSL_BUILD_DIR%; echo '--- [WSL] Running npm install (for Linux platform)...'; npm install; echo '--- [WSL] Running npm run make (for Linux)...'; npm run make; echo '--- [WSL] Packaging Linux artifacts into a tarball...'; cd out/make; tar -czvf /tmp/%LINUX_ARTIFACT_NAME% .; echo '--- [WSL] Cleaning up temporary build directory...'; rm -rf %WSL_BUILD_DIR%; echo '--- [WSL] Linux build process complete. ---';"

if %errorlevel% neq 0 (
    echo [ERROR] The WSL build process failed. Check the output above for details.
    exit /b 1
)

:: =============================================================================
:: PHASE 3: COLLECT ARTIFACTS
:: =============================================================================
echo.
echo Copying Linux artifact tarball from WSL to Windows project directory...

%WSL_EXEC% cp "/tmp/%LINUX_ARTIFACT_NAME%" "%WSL_PROJECT_DIR%/out/"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to copy artifact from WSL to Windows.
    echo The file may be at /tmp/%LINUX_ARTIFACT_NAME% inside your WSL distro.
    exit /b 1
)

%WSL_EXEC% rm "/tmp/%LINUX_ARTIFACT_NAME%"

:: =============================================================================
:: FINAL SUMMARY
:: =============================================================================
echo.
echo ===================================
echo           ALL BUILDS COMPLETE
echo ===================================
echo.
echo - Windows installer is in:   %cd%\out\make\
echo - Linux packages archive is in: %cd%\out\%LINUX_ARTIFACT_NAME%
echo.

endlocal
pause