$env:JAVA_HOME = "C:\Program Files\Zulu\zulu-26"
$env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH
cmd /c "mvn.cmd -o -pl ui.apps -PautoInstallPackage `"-Daem.port=4506`" clean install > design\scratch\build-testimonial-deploy.log 2>&1"
Select-String -Path design\scratch\build-testimonial-deploy.log -Pattern "BUILD SUCCESS|BUILD FAILURE"
