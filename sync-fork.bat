```bat
@echo off
setlocal EnableExtensions

title IllegalcordPlus - Upstream Sync

echo.
echo ================================================
echo       IllegalcordPlus Upstream Sync
echo ================================================
echo.

REM ==================================================
REM 1. Verify this is a Git repository
REM ==================================================

git rev-parse --is-inside-work-tree >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ This directory is not a Git repository.
    echo.
    pause
    exit /b 1
)

REM ==================================================
REM 2. Verify remotes
REM ==================================================

echo 🔍 Checking Git remotes...
echo.

git remote get-url origin >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ Remote "origin" does not exist.
    echo    Expected: https://github.com/ph34rar5on/IllegalcordPlus.git
    echo.
    pause
    exit /b 1
)

git remote get-url upstream >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ❌ Remote "upstream" does not exist.
    echo    Expected: https://github.com/ImHisako/Illegalcord.git
    echo.
    pause
    exit /b 1
)

REM ==================================================
REM 3. Show current branch
REM ==================================================

echo 🌿 Checking current branch...

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"

if not "%CURRENT_BRANCH%"=="main" (
    echo.
    echo ⚠️  You are currently on: %CURRENT_BRANCH%
    echo    This script requires the main branch.
    echo.

    choice /C YN /N /M "Switch to main? [Y/N]: "

    if errorlevel 2 (
        echo.
        echo ❌ Sync cancelled.
        pause
        exit /b 1
    )

    echo.
    echo 🔀 Switching to main...

    git checkout main
    if %ERRORLEVEL% neq 0 (
        echo ❌ Failed to switch to main.
        echo    You may have uncommitted changes or another checkout issue.
        pause
        exit /b 1
    )
)

REM ==================================================
REM 4. Check for uncommitted changes
REM ==================================================

echo.
echo 🔍 Checking for uncommitted changes...

git diff --quiet
if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ You have uncommitted changes.
    echo    Commit or stash them before syncing.
    echo.
    git status --short
    echo.
    pause
    exit /b 1
)

git diff --cached --quiet
if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ You have staged changes that are not committed.
    echo    Commit or unstage them before syncing.
    echo.
    git status --short
    echo.
    pause
    exit /b 1
)

REM ==================================================
REM 5. Fetch upstream
REM ==================================================

echo.
echo 🔄 Fetching latest changes from upstream...
echo    https://github.com/ImHisako/Illegalcord
echo.

git fetch upstream
if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ Failed to fetch from upstream.
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Upstream fetch successful.

REM ==================================================
REM 6. Make sure local main is up to date with origin
REM ==================================================

echo.
echo 🔍 Checking origin/main...

git fetch origin
if %ERRORLEVEL% neq 0 (
    echo.
    echo ⚠️  Could not fetch origin.
    echo    Continuing anyway...
)

REM ==================================================
REM 7. Merge upstream/dev
REM ==================================================

echo.
echo 🔀 Merging upstream/dev into main...
echo.

git -c core.editor=true merge upstream/dev --no-edit --no-ff -m "Merge upstream/dev"

if %ERRORLEVEL% neq 0 (
    echo.
    echo ================================================
    echo ❌ MERGE FAILED
    echo ================================================
    echo.
    echo There may be merge conflicts.
    echo.
    echo Run:
    echo.
    echo     git status
    echo.
    echo Resolve the conflicts, then:
    echo.
    echo     git add .
    echo     git commit
    echo.
    echo After resolving them, push with:
    echo.
    echo     git push origin main
    echo.
    pause
    exit /b 1
)

echo.
echo ✅ Successfully merged upstream/dev.

REM ==================================================
REM 8. Push to your fork
REM ==================================================

echo.
echo ⬆️  Pushing main to your fork...
echo    https://github.com/ph34rar5on/IllegalcordPlus
echo.

git push origin main

if %ERRORLEVEL% neq 0 (
    echo.
    echo ================================================
    echo ❌ PUSH FAILED
    echo ================================================
    echo.
    echo The merge succeeded locally, but pushing to
    echo origin/main failed.
    echo.
    echo Your local main is still intact.
    echo.
    pause
    exit /b 1
)

REM ==================================================
REM 9. Success
REM ==================================================

echo.
echo ================================================
echo          ✅ SYNC SUCCESSFUL
echo ================================================
echo.
echo Upstream:
echo   ImHisako/Illegalcord
echo.
echo Branch:
echo   upstream/dev → main
echo.
echo Fork:
echo   ph34rar5on/IllegalcordPlus
echo.
echo Your fork is now synchronized.
echo.

pause
exit /b 0
```
