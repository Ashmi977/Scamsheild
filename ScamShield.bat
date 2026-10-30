@echo off
rem Opens the ScamShield Dashboard (browser-extension and desktop checks; Analyzer and History are one click away).
rem Double-click this file, or point a desktop shortcut at it.
rem Runs from the project folder so config\scamshield.properties (MySQL settings) is found.
cd /d "%~dp0"

set "JAR=target\scamshield-1.1.0.jar"
if not exist "%JAR%" (
    echo ScamShield has not been built yet: %JAR% is missing.
    echo Build it first with:  mvn package
    pause
    exit /b 1
)

rem Pick Java: the installed JDK 27, then JAVA_HOME, then javaw on PATH.
set "JAVAW=C:\Program Files\Java\jdk-27.0.1.0.3\bin\javaw.exe"
if exist "%JAVAW%" goto run
set "JAVAW=%JAVA_HOME%\bin\javaw.exe"
if defined JAVA_HOME if exist "%JAVAW%" goto run
set "JAVAW="
for %%J in (javaw.exe) do set "JAVAW=%%~$PATH:J"
if defined JAVAW goto run
echo Java was not found. Install JDK 21 or newer, or set JAVA_HOME.
pause
exit /b 1

:run
rem The app starts on the Dashboard screen.
start "ScamShield Dashboard" "%JAVAW%" -jar "%JAR%"
