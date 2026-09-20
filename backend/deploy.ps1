# MedClear Backend SAM Deploy Script
# Forces UTF-8 encoding mode in Python to handle non-ASCII Windows paths

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 >$null

# Remove any stale temporary session tokens that might conflict with ~/.aws/credentials
Remove-Item env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue

Write-Host "Deploying MedClear Serverless Stack to AWS..." -ForegroundColor Cyan
sam deploy --guided
