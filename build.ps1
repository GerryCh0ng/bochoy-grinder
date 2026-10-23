param(
  [string]$Out = "dist"
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root $Out
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-ZipFromFolder {
  param(
    [string]$Source,
    [string]$ZipPath,
    [string]$Root
  )

  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  $stream = [System.IO.File]::Open($ZipPath, [System.IO.FileMode]::CreateNew)
  try {
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($file in Get-ChildItem $Source -Recurse -File) {
        $relative = $file.FullName.Substring($Root.Length).TrimStart('\').Replace('\', '/')
        $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        try {
          $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
          $entryStream.Write($bytes, 0, $bytes.Length)
        } finally {
          $entryStream.Dispose()
        }
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    $stream.Dispose()
  }

  Write-Host "built $ZipPath"
}

# 1) Plugin package: manifest.json + plugin.js at the zip root.
$pluginDir = Join-Path $root "crystal-grinder.reaplugin"
$pluginManifest = Get-Content (Join-Path $pluginDir "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$pluginZip = Join-Path $outDir "crystal-grinder-$($pluginManifest.version).zip"
New-ZipFromFolder -Source $pluginDir -ZipPath $pluginZip -Root $pluginDir

# 2) Skin package: index.html + src/ at the zip root.
$skinDir = Join-Path $root "skin\streamline-crystal"
$skinManifest = Get-Content (Join-Path $skinDir "skin-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$skinZip = Join-Path $outDir "streamline-crystal-$($skinManifest.version).zip"
New-ZipFromFolder -Source $skinDir -ZipPath $skinZip -Root $skinDir
