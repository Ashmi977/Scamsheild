@echo off
rem Connector between the ScamShield browser extension and the desktop dashboard.
rem Chrome/Edge start this file themselves (registered by scripts\install-native-host.ps1).
rem Do not add any "echo" here: everything written to the console goes to the browser as protocol data.
setlocal
cd /d "%~dp0.."
set "JAR=target\scamshield-1.1.0.jar"
set "JAVA=C:\Program Files\Java\jdk-27.0.1.0.3\bin\java.exe"
if not exist "%JAVA%" if defined JAVA_HOME set "JAVA=%JAVA_HOME%\bin\java.exe"
if not exist "%JAVA%" set "JAVA=java"
"%JAVA%" -Xshare:auto -XX:TieredStopAtLevel=1 -cp "%JAR%" com.scamshield.Main --native-host %*
