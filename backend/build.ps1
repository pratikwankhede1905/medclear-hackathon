# MedClear Backend SAM Build Script
# Forces UTF-8 encoding mode in Python to handle non-ASCII Windows paths

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 >$null

Write-Host "Building MedClear Serverless Backend..." -ForegroundColor Cyan
sam build

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nBuild Succeeded! You can now run .\deploy.ps1 to deploy to AWS." -ForegroundColor Green
} else {
    Write-Host "`nBuild Failed. Please check the logs above." -ForegroundColor Red
}

