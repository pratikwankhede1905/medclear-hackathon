# MedClear Backend SAM Deploy Script
# Forces UTF-8 encoding mode in Python to handle non-ASCII Windows paths

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 >$null

Write-Host "Deploying MedClear Serverless Stack to AWS..." -ForegroundColor Cyan
sam deploy --guided

