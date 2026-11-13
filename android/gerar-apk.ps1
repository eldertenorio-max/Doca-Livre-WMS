# Gera o instalador do aplicativo Android do WMS neste computador, assinado com a chave local.
#
#   powershell -ExecutionPolicy Bypass -File android\gerar-apk.ps1
#
# O que faz: compila a pasta android/, assina com instance\android-release.p12, confere se a assinatura e a que o
# sistema declara em /.well-known/assetlinks.json e copia o APK para static\app\doca-livre-wms.apk, que e o arquivo
# do botao "Baixar o app" (Coletor > Aplicativo Android). Depois e so publicar o sistema.
#
# Precisa, uma vez so, do Android SDK com a plataforma 34. Se faltar, o script mostra o comando para instalar
# (a instalacao pede que VOCE aceite os termos de licenca do Android).
$ErrorActionPreference = 'Stop'
$projeto = Split-Path -Parent $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$gradle = "$env:LOCALAPPDATA\doca-livre-android\gradle-8.9\bin\gradle.bat"
$chave = Join-Path $projeto 'instance\android-release.p12'
$senha = Join-Path $projeto 'instance\android-keystore-senha.txt'

if (-not (Test-Path "$sdk\platforms\android-34") -or -not (Test-Path "$sdk\build-tools")) {
    Write-Host "Falta instalar a plataforma do Android (uma vez so). Rode este comando e responda 'y' para aceitar as licencas:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  & `"$sdk\cmdline-tools\latest\bin\sdkmanager.bat`" --sdk_root=`"$sdk`" `"platform-tools`" `"platforms;android-34`" `"build-tools;34.0.0`""
    Write-Host ""
    Write-Host "Depois rode este script de novo."
    exit 1
}
foreach ($arquivo in @($gradle, $chave, $senha)) {
    if (-not (Test-Path $arquivo)) { Write-Host "Nao encontrei: $arquivo" -ForegroundColor Red; exit 1 }
}

# cada instalador novo precisa de um numero de versao maior, para instalar por cima do anterior
$arquivoVersao = Join-Path $PSScriptRoot 'versao.txt'
$versao = 1 + [int](Get-Content $arquivoVersao -ErrorAction SilentlyContinue | Select-Object -First 1)

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_KEYSTORE_FILE = $chave
$env:ANDROID_KEYSTORE_PASSWORD = (Get-Content $senha -Raw).Trim()
$env:VERSION_CODE = "$versao"

Push-Location $PSScriptRoot
try {
    & $gradle --no-daemon assembleRelease
    if ($LASTEXITCODE -ne 0) { Write-Host "A compilacao falhou." -ForegroundColor Red; exit 1 }
} finally {
    Pop-Location
    $env:ANDROID_KEYSTORE_PASSWORD = $null
}

$apk = Join-Path $PSScriptRoot 'app\build\outputs\apk\release\app-release.apk'
$apksigner = Get-ChildItem "$sdk\build-tools\*\apksigner.bat" | Sort-Object FullName | Select-Object -Last 1
$saida = & $apksigner.FullName verify --print-certs $apk
$impressao = (($saida | Select-String 'SHA-256' | Select-Object -First 1).ToString() -replace '.*:\s*', '').ToUpper()
$esperada = ((Select-String -Path (Join-Path $projeto 'wms\aplicativo.py') -Pattern "SHA256_DA_CHAVE = '([^']+)'").Matches[0].Groups[1].Value -replace ':', '')
if ($impressao -ne $esperada) {
    Write-Host "A chave que assinou o APK nao e a que o sistema declara (assetlinks). Nada foi copiado." -ForegroundColor Red
    exit 1
}

$destino = Join-Path $projeto 'static\app'
New-Item -ItemType Directory -Force $destino | Out-Null
Copy-Item $apk (Join-Path $destino 'doca-livre-wms.apk') -Force
Set-Content $arquivoVersao "$versao" -Encoding ascii
$tamanho = [math]::Round((Get-Item (Join-Path $destino 'doca-livre-wms.apk')).Length / 1MB, 2)
Write-Host ""
Write-Host "APK gerado: static\app\doca-livre-wms.apk (versao 1.0.$versao, $tamanho MB), assinatura conferida." -ForegroundColor Green
Write-Host "Agora publique o sistema para o botao 'Baixar o app' passar a entregar esta versao."
