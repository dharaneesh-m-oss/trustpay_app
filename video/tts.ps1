# Generates one WAV per narration segment using the Windows speech engine.
#
# SAPI is what this machine has. The voice is audibly synthetic - fine for a
# draft or a walkthrough, and worth replacing with a real recording before this
# goes in front of judges. The build accepts any WAV with the same filenames, so
# swapping in human audio needs no changes anywhere else.

param(
    [string]$ScriptPath = "script.json",
    [string]$OutDir     = "audio",
    [string]$VoiceName  = "Microsoft Zira Desktop",
    [int]$Rate          = 0
)

Add-Type -AssemblyName System.Speech

# The speech engine writes through .NET, which resolves relative paths against
# the process working directory rather than PowerShell's location. Absolute
# paths from here on, or the files land somewhere unexpected - or nowhere.
$Root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptPath = Join-Path $Root $ScriptPath
$OutDir     = Join-Path $Root $OutDir

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$plan = Get-Content $ScriptPath -Raw | ConvertFrom-Json

foreach ($seg in $plan.segments) {
    $wav = Join-Path $OutDir ("seg-" + $seg.id + ".wav")

    # A fresh synthesiser per file: reusing one across SetOutputToWaveFile calls
    # leaves the previous file locked and occasionally truncates it.
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        $synth.SelectVoice($VoiceName)
    } catch {
        Write-Host "  (voice '$VoiceName' unavailable, using the default)"
    }
    $synth.Rate = $Rate
    $synth.SetOutputToWaveFile($wav)
    $synth.Speak($seg.text)
    $synth.Dispose()

    $len = (Get-Item $wav).Length
    Write-Host ("seg-" + $seg.id + "  " + $len + " bytes")
}

Write-Host "done"
