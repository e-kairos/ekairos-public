[CmdletBinding()]
param(
  [ValidateSet("help", "init", "up", "down", "restart", "status", "logs", "pull", "clean")]
  [string]$Command = "up",
  [string]$RepoHome = $env:DAYTONA_OSS_HOME,
  [string]$Ref = $env:DAYTONA_OSS_REF,
  [string]$ComposeFile = $env:DAYTONA_OSS_COMPOSE
)

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Resolve-HomePath {
  if ($RepoHome) {
    return $RepoHome
  }
  return (Join-Path $HOME ".ekairos\\daytona-oss")
}

function Ensure-Repo([bool]$AllowClone) {
  $repoHome = Resolve-HomePath
  $gitDir = Join-Path $repoHome ".git"

  if (Test-Path $repoHome) {
    if (-not (Test-Path $gitDir)) {
      throw "DAYTONA_OSS_HOME exists but is not a git repo: $repoHome"
    }
  } else {
    if (-not $AllowClone) {
      throw "Daytona repo not found at $repoHome. Run 'init' first."
    }
    Require-Command "git"
    Write-Host "Cloning Daytona OSS repo to $repoHome"
    & git clone https://github.com/daytonaio/daytona $repoHome
    if ($LASTEXITCODE -ne 0) {
      throw "git clone failed"
    }
  }

  if ($Ref) {
    Require-Command "git"
    & git -C $repoHome fetch --all --tags --prune
    if ($LASTEXITCODE -ne 0) {
      throw "git fetch failed"
    }
    & git -C $repoHome checkout $Ref
    if ($LASTEXITCODE -ne 0) {
      throw "git checkout failed: $Ref"
    }
  }

  return $repoHome
}

function Resolve-ComposePath([string]$RepoHome) {
  if ($ComposeFile) {
    return $ComposeFile
  }
  return (Join-Path $RepoHome "docker\\docker-compose.yaml")
}

function Print-Help {
  Write-Host "Usage:"
  Write-Host "  ./scripts/daytona-local.ps1 <command> [-RepoHome PATH] [-Ref REF]"
  Write-Host ""
  Write-Host "Commands:"
  Write-Host "  init     Clone Daytona OSS repo (outside this workspace by default)"
  Write-Host "  up       Start the local Daytona stack via Docker Compose"
  Write-Host "  down     Stop the local Daytona stack"
  Write-Host "  restart  Restart the local Daytona stack"
  Write-Host "  status   Show container status"
  Write-Host "  logs     Tail logs"
  Write-Host "  pull     Pull latest changes in the Daytona repo"
  Write-Host "  clean    Stop and remove volumes"
  Write-Host "  help     Show this help"
  Write-Host ""
  Write-Host "Env vars:"
  Write-Host "  DAYTONA_OSS_HOME    Clone location (default: \$HOME\\.ekairos\\daytona-oss)"
  Write-Host "  DAYTONA_OSS_REF     Git ref (tag/commit/branch) for repeatable setups"
  Write-Host "  DAYTONA_OSS_COMPOSE Override compose file path"
}

if ($Command -eq "help") {
  Print-Help
  return
}

Require-Command "docker"

switch ($Command) {
  "init" {
    $repoHome = Ensure-Repo $true
    Write-Host "Repo ready at: $repoHome"
    return
  }
  "pull" {
    $repoHome = Ensure-Repo $true
    Require-Command "git"
    & git -C $repoHome pull --ff-only
    if ($LASTEXITCODE -ne 0) {
      throw "git pull failed"
    }
    return
  }
  "up" {
    $repoHome = Ensure-Repo $true
    $compose = Resolve-ComposePath $repoHome
    if (-not (Test-Path $compose)) {
      throw "Compose file not found: $compose"
    }
    & docker compose -f $compose up -d
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose up failed"
    }
    Write-Host "Dashboard: http://localhost:3000"
    Write-Host "API URL:  http://localhost:3000/api"
    Write-Host "Set SANDBOX_PROVIDER=daytona and DAYTONA_API_KEY to use it."
    return
  }
  "down" {
    $repoHome = Ensure-Repo $false
    $compose = Resolve-ComposePath $repoHome
    & docker compose -f $compose down
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose down failed"
    }
    return
  }
  "restart" {
    $repoHome = Ensure-Repo $false
    $compose = Resolve-ComposePath $repoHome
    & docker compose -f $compose down
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose down failed"
    }
    & docker compose -f $compose up -d
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose up failed"
    }
    return
  }
  "status" {
    $repoHome = Ensure-Repo $false
    $compose = Resolve-ComposePath $repoHome
    & docker compose -f $compose ps
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose ps failed"
    }
    return
  }
  "logs" {
    $repoHome = Ensure-Repo $false
    $compose = Resolve-ComposePath $repoHome
    & docker compose -f $compose logs -f --tail 200
    return
  }
  "clean" {
    $repoHome = Ensure-Repo $false
    $compose = Resolve-ComposePath $repoHome
    & docker compose -f $compose down -v
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose down -v failed"
    }
    return
  }
  default {
    Print-Help
  }
}
