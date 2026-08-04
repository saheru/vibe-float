[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet(
        "doctor",
        "test-plugin",
        "build-windows",
        "publish-windows",
        "smoke-windows",
        "verify-windows"
    )]
    [string]$Task = "verify-windows",

    [string]$OutputDirectory = "",

    [ValidateRange(1, 120)]
    [int]$StartupTimeoutSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WindowsProject = Join-Path $ProjectRoot "windows\CodexFloat\CodexFloat.csproj"
$PluginDirectory = Join-Path $ProjectRoot "com.tlm.codex-control.sdPlugin\plugin"
$ArtifactsRoot = Join-Path $ProjectRoot "artifacts"
$LocalDotNet = Join-Path $ProjectRoot ".tools\dotnet\dotnet.exe"
$DotNetCommand = if (Test-Path -LiteralPath $LocalDotNet) { $LocalDotNet } else { "dotnet" }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $ArtifactsRoot "windows-x64\Vibe-Float"
}
elseif (-not [IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory = Join-Path $ProjectRoot $OutputDirectory
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$RunningOnWindows = $env:OS -eq "Windows_NT"

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function Assert-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $InstallHint"
    }
}

function Invoke-Doctor {
    Write-Step "Checking maintenance prerequisites"
    Assert-Command "node" "Install Node.js 20 or newer."
    Assert-Command "npm" "Install npm with Node.js 20 or newer."

    $nodeVersion = (& node --version).Trim().TrimStart("v")
    if ([int]$nodeVersion.Split(".")[0] -lt 20) {
        throw "Node.js 20 or newer is required; found $nodeVersion."
    }
    Write-Host "Node.js $nodeVersion"

    if ($RunningOnWindows) {
        Assert-Command $DotNetCommand "Install the .NET 8 SDK."
        $sdks = @(& $DotNetCommand --list-sdks)
        if ($LASTEXITCODE -ne 0) { throw "Unable to list installed .NET SDKs." }
        if (-not ($sdks | Where-Object { $_ -match '^8\.' })) {
            $installed = if ($sdks.Count -gt 0) { $sdks -join ", " } else { "none" }
            throw ".NET 8 SDK is required; installed SDKs: $installed"
        }
        Write-Host ($sdks | Where-Object { $_ -match '^8\.' } | Select-Object -Last 1)
    }

    Write-Host "Prerequisite check passed." -ForegroundColor Green
}

function Invoke-PluginTests {
    Write-Step "Installing locked StreamDock dependencies"
    Invoke-Checked "npm" @("--prefix", $PluginDirectory, "ci", "--ignore-scripts")
    Write-Step "Running StreamDock tests"
    Push-Location $ProjectRoot
    try {
        Invoke-Checked "npm" @("test")
    }
    finally {
        Pop-Location
    }
}

function Assert-Windows {
    if (-not $RunningOnWindows) {
        throw "This task requires Windows."
    }
}

function Invoke-WindowsBuild {
    Assert-Windows
    Assert-Command $DotNetCommand "Install the .NET 8 SDK."
    Write-Step "Building the Windows app"
    Invoke-Checked $DotNetCommand @("build", $WindowsProject, "-c", "Release", "--nologo")
}

function Assert-ArtifactOutputPath {
    $allowedRoot = [IO.Path]::GetFullPath($ArtifactsRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $OutputDirectory.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "OutputDirectory must be inside $ArtifactsRoot"
    }
}

function Invoke-WindowsPublish {
    Assert-Windows
    Assert-Command $DotNetCommand "Install the .NET 8 SDK."
    Assert-ArtifactOutputPath
    Write-Step "Publishing the self-contained Windows app"
    if (Test-Path -LiteralPath $OutputDirectory) {
        Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    Invoke-Checked $DotNetCommand @(
        "publish", $WindowsProject,
        "-c", "Release",
        "-r", "win-x64",
        "--self-contained", "true",
        "-p:PublishSingleFile=false",
        "-p:DebugType=None",
        "-o", $OutputDirectory,
        "--nologo"
    )
    Copy-Item -Path (Join-Path $ProjectRoot "windows\package\*") -Destination $OutputDirectory -Force
    Write-Host $OutputDirectory -ForegroundColor Green
}

function Read-Log([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    return [IO.File]::ReadAllText($Path)
}

function Invoke-WindowsSmokeTest {
    Assert-Windows
    $exe = Join-Path $OutputDirectory "VibeFloat.exe"
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "Published executable not found at $exe. Run publish-windows first."
    }

    $logPath = Join-Path $env:LOCALAPPDATA "Vibe Float\startup.log"
    $before = Read-Log $logPath
    Write-Step "Smoke-testing Windows startup"
    $process = Start-Process -FilePath $exe -ArgumentList "--smoke-test" -PassThru -WindowStyle Hidden
    try {
        if (-not $process.WaitForExit($StartupTimeoutSeconds * 1000)) {
            throw "Smoke test timed out after $StartupTimeoutSeconds seconds."
        }
    }
    finally {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }

    $after = Read-Log $logPath
    $currentRun = if ($after.StartsWith($before, [StringComparison]::Ordinal)) {
        $after.Substring($before.Length)
    }
    else {
        $after
    }
    if ($currentRun -match "Startup failed|Unhandled AppDomain exception|UI exception") {
        throw "Smoke test logged a startup error:`n$currentRun"
    }
    if ($process.ExitCode -ne 0) {
        throw "Smoke test exited with code $($process.ExitCode):`n$currentRun"
    }
    if ($currentRun -notmatch "Smoke test passed") {
        throw "Smoke test did not record its success marker:`n$currentRun"
    }
    Write-Host "Windows startup smoke test passed." -ForegroundColor Green
}

switch ($Task) {
    "doctor" { Invoke-Doctor }
    "test-plugin" { Invoke-PluginTests }
    "build-windows" { Invoke-WindowsBuild }
    "publish-windows" { Invoke-WindowsPublish }
    "smoke-windows" { Invoke-WindowsSmokeTest }
    "verify-windows" {
        Invoke-Doctor
        Invoke-PluginTests
        Invoke-WindowsPublish
        Invoke-WindowsSmokeTest
    }
}
