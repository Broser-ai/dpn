Param(
  [switch]$Strict
)

$ErrorActionPreference = 'Stop'

function Resolve-FirstSetValue {
  Param([string[]]$Names)
  foreach ($name in $Names) {
    $item = Get-Item -Path ("Env:" + $name) -ErrorAction SilentlyContinue
    if ($item -and -not [string]::IsNullOrWhiteSpace($item.Value)) {
      return @{ Name = $name; Value = $item.Value }
    }
  }
  return $null
}

# Critical runtime/deploy requirements.
$requiredGroups = @(
  @('ANTHROPIC_API_KEY'),
  @('SUPABASE_URL'),
  @('SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
  @('STRIPE_SECRET_KEY'),
  @('STRIPE_WEBHOOK_SECRET'),
  @('ADMIN_SECRET_KEY', 'DPN_ADMIN_KEY'),
  @('FAL_KEY')
)

# Recommended keys for autonomous harness to run end-to-end.
$recommendedGroups = @(
  @('POSTMARK_SERVER_TOKEN', 'POSTMARK_TOKEN', 'POSTMARK_API_KEY'),
  @('POSTMARK_FROM'),
  @('RESEND_API_KEY'),
  @('WORDPRESS_URL'),
  @('WORDPRESS_USER'),
  @('WORDPRESS_APP_PASSWORD')
)

$missingRequired = @()
$missingRecommended = @()

Write-Output '=== DPN Environment Validation (PowerShell) ==='
Write-Output ''
Write-Output 'Required:'

foreach ($group in $requiredGroups) {
  $resolved = Resolve-FirstSetValue -Names $group
  if ($resolved) {
    Write-Output ("  [OK] " + ($group -join ' | ') + "  (using " + $resolved.Name + ")")
  } else {
    Write-Output ("  [MISSING] " + ($group -join ' | '))
    $missingRequired += ,$group
  }
}

Write-Output ''
Write-Output 'Recommended:'

foreach ($group in $recommendedGroups) {
  $resolved = Resolve-FirstSetValue -Names $group
  if ($resolved) {
    Write-Output ("  [OK] " + ($group -join ' | ') + "  (using " + $resolved.Name + ")")
  } else {
    Write-Output ("  [MISSING] " + ($group -join ' | '))
    $missingRecommended += ,$group
  }
}

Write-Output ''
if ($missingRequired.Count -gt 0) {
  Write-Output ('Result: FAIL - missing required groups: ' + $missingRequired.Count)
  if ($Strict) { exit 1 }
} else {
  Write-Output 'Result: PASS - all required groups set.'
}

if ($missingRecommended.Count -gt 0) {
  Write-Output ('Note: missing recommended groups: ' + $missingRecommended.Count)
} else {
  Write-Output 'Note: all recommended groups set.'
}
