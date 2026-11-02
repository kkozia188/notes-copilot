$ErrorActionPreference = 'Stop'
try {
    & wsl.exe -d Ubuntu-22.04 -- systemctl --user start notes-copilot-codex.service
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the Notes Copilot service in WSL.' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/config' -TimeoutSec 2
            $config = $response.Content | ConvertFrom-Json
            if ($config.backend -eq 'codex') { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Notes Copilot did not become ready. Check the WSL service logs.' }
    Start-Process 'http://127.0.0.1:8787/'
    Write-Output 'Notes Copilot is ready at http://127.0.0.1:8787/'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}
