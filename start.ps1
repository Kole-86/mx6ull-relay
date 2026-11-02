$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
& node (Join-Path $PSScriptRoot 'assistant/bridge.mjs')
exit $LASTEXITCODE
