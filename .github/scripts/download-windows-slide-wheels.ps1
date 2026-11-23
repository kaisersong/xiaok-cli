$wheelDir = Join-Path (Resolve-Path ..\kai-xiaok-plugins\plugins\kai-slide-creator).Path 'bundled-wheels'
Remove-Item -LiteralPath $wheelDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $wheelDir | Out-Null
foreach ($py in @('311', '312', '313', '314')) {
  python -m pip download mcp==2.3.0 pydantic==2.13.4 jsonschema==4.26.0 beautifulsoup4 `
    -d $wheelDir `
    --only-binary=:all: `
    --platform win_amd64 `
    --implementation cp `
    --python-version $py `
    --abi "cp$py" `
    --abi abi3 `
    --abi none
}
