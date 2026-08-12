<#
  build-campus.ps1 - stage B of the two-stage recording workflow.

  Turns a raw Playwright capture into the narrated MP4 and a shareable GIF. Nothing here
  re-records, so narration, pacing and the GIF window can be iterated in seconds against the
  same .webm.

  Cut points are NOT reusable between takes. Re-derive them after every stage A run, using the
  method in README.md: silencedetect on the voice-over to find the narration beats, and a
  one-frame-per-second PNG size scan on the raw file to find the site-load window that renders
  as a black canvas. The values below are for the take named in -Raw.

  Two segments, two speeds, on purpose. Segment A is the Garching half and must play at 1.0x,
  because it is timed against narration that starts at zero: speeding it up slides the site cut
  away from the words "Now switch site." Segment B is then fitted independently so the
  Sanierungsstau beat and the closing line land where the voice expects them. An 11% difference
  across a hard cut is imperceptible; a mistimed cut is not.
#>
[CmdletBinding()]
param(
  # Where the raw capture, the voice-over and the out/ folder live.
  [string]$WorkDir = $env:CAMPUS_REC_OUT,
  [string]$Raw = 'out\page@40b5a7976deda42ca8683f5b6186dc54.webm',
  [string]$Vo = 'vo-campus.mp3',

  # Garching: wide shot -> explode -> rooms -> flow. Ends where the canvas goes black.
  [double]$A0 = 32.747,
  [double]$A1 = 78.6,
  [double]$ASpeed = 1.0,

  # Tuebingen: reveal -> condition lens -> 2040 -> settled Altstadt. Starts where it renders again.
  [double]$B0 = 85.6,
  [double]$B1 = 111.5,
  [double]$BSpeed = 1.113,

  [double]$FadeOut = 66.9,
  # The GIF is the silent hook: centred on the building opening up, which is the one beat that
  # reads without narration.
  [double]$GifStart = 17,
  [double]$GifLength = 17
)

$ErrorActionPreference = 'Stop'
if (-not $WorkDir) { $WorkDir = 'C:\Users\alkorn\repos\temp\rec' }
Set-Location $WorkDir

$vis = 'out\campus-visual.mp4'
$mp4 = 'out\campus-insights-demo.mp4'
$gif = 'out\campus-insights-demo.gif'

foreach ($required in $Raw, $Vo) {
  if (-not (Test-Path $required)) { throw "missing input: $required (in $WorkDir)" }
}

$filter = "[0:v]trim=${A0}:${A1},setpts=(PTS-STARTPTS)/${ASpeed}[a];" +
          "[0:v]trim=${B0}:${B1},setpts=(PTS-STARTPTS)/${BSpeed}[b];" +
          "[a][b]concat=n=2:v=1[c];" +
          "[c]fps=30,fade=t=in:st=0:d=0.5,fade=t=out:st=${FadeOut}:d=0.7[v]"

Write-Host 'building visual track...'
ffmpeg -y -v error -i $Raw -filter_complex $filter -map '[v]' -an `
  -c:v libx264 -pix_fmt yuv420p -crf 20 -preset medium -movflags +faststart $vis
if ($LASTEXITCODE -ne 0) { throw 'visual pass failed' }

# The video is left slightly longer than the voice-over so -shortest trims the picture rather
# than truncating the narration.
Write-Host 'muxing voice-over...'
ffmpeg -y -v error -i $vis -i $Vo -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 176k `
  -af 'afade=t=in:st=0:d=0.25,afade=t=out:st=67.0:d=0.6' -shortest $mp4
if ($LASTEXITCODE -ne 0) { throw 'mux failed' }

# 660px and 12fps are a size compromise: the 20cm orthophoto drape quantises badly, so this lands
# near 6 MB and stays postable where GIFs are capped around 10. palettegen runs over the same
# window or the ground bands.
Write-Host 'building gif...'
ffmpeg -y -v error -ss $GifStart -t $GifLength -i $mp4 `
  -vf 'fps=12,scale=660:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' `
  $gif
if ($LASTEXITCODE -ne 0) { throw 'gif failed' }

foreach ($f in @($mp4, $gif)) {
  $mb = '{0:N1}' -f ((Get-Item $f).Length / 1MB)
  $d = ffprobe -v error -show_entries format=duration -of csv=p=0 $f
  Write-Host ("{0,-42} {1,7} MB  {2}s" -f $f, $mb, $d)
}
