---
name: e2e-test
description: "Orchestrate E2E cross-browser testing with Selenoid, browser images, and selenoid-bridge. Use this skill whenever the user wants to: set up a browser testing environment, create E2E test scenarios, run cross-browser tests, manage Selenoid sessions, check test environment status, or anything related to browser automation testing. Triggers on: /e2e-test, 'run e2e tests', 'set up test environment', 'create test scenario', 'cross-browser test', 'selenoid', 'browser test'."
---

# E2E Test Orchestrator

Cross-browser E2E testing workflow using Selenoid (container management), browser images, and selenoid-bridge (scenario execution).

## Configuration

Set these environment variables to customize paths. Defaults assume the `selenoid-workspace` layout.

| Variable | Default | Purpose |
|----------|---------|---------|
| `SELENOID_DIR` | `packages/selenoid` | Selenoid source directory |
| `SELENOID_IMAGES_DIR` | `packages/images` | Images builder directory |
| `SELENOID_BRIDGE_DIR` | `packages/bridge` | Bridge package directory |
| `SELENOID_BIN` | `/tmp/selenoid-test` | Built Selenoid binary path |
| `SELENOID_PORT` | `4444` | Selenoid listen port |
| `SELENOID_CONFIG` | `/tmp/browsers-test.json` | browsers.json path |
| `SELENOID_LIMIT` | `5` | Max concurrent sessions |

Resolve paths before running commands (assumes workspace root or env vars):

```bash
WORKSPACE="${SELENOID_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
BRIDGE_DIR="${SELENOID_BRIDGE_DIR:-$WORKSPACE/packages/bridge}"
SELENOID_DIR="${SELENOID_DIR:-$WORKSPACE/packages/selenoid}"
SELENOID_IMAGES_DIR="${SELENOID_IMAGES_DIR:-$WORKSPACE/packages/images}"
SELENOID_BIN="${SELENOID_BIN:-/tmp/selenoid-test}"
SELENOID_PORT="${SELENOID_PORT:-4444}"
SELENOID_CONFIG="${SELENOID_CONFIG:-/tmp/browsers-test.json}"
SELENOID_LIMIT="${SELENOID_LIMIT:-5}"
SELENOID_URL="http://localhost:$SELENOID_PORT"
```

## Commands

### `/e2e-test setup [--browsers chrome:128.0,firefox:130.0]`

Set up the complete testing environment:

1. **Check Docker**
   ```bash
   docker info >/dev/null 2>&1 || echo "Docker is not running"
   ```

2. **Build Selenoid**
   ```bash
   cd "$SELENOID_DIR" && go build -o "$SELENOID_BIN" .
   ```

3. **Pull browser images** — Parse the `--browsers` argument (default: `chrome:128.0`)
   ```bash
   docker pull selenoid/chrome:128.0
   # If firefox requested:
   docker pull selenoid/firefox:130.0
   ```

4. **Generate browsers.json** — Write `$SELENOID_CONFIG` with entries for each pulled image.

   Chrome entry format:
   ```json
   { "image": "selenoid/chrome:128.0", "port": "4444", "path": "/" }
   ```
   Firefox entry format:
   ```json
   { "image": "selenoid/firefox:130.0", "port": "4444", "path": "/wd/hub" }
   ```

5. **Start Selenoid**
   ```bash
   "$SELENOID_BIN" -listen ":$SELENOID_PORT" -conf "$SELENOID_CONFIG" \
     -limit "$SELENOID_LIMIT" -timeout 60s -disable-privileged &
   ```

6. **Verify**
   ```bash
   sleep 2 && curl -s "$SELENOID_URL/ping"
   ```

7. **Install bridge deps** (if `node_modules/` missing)
   ```bash
   cd "$BRIDGE_DIR" && npm install && npm run build
   ```

### `/e2e-test create <name> [--url <baseUrl>]`

Create a new test scenario:

```bash
cd "$BRIDGE_DIR" && node dist/index.js create "<name>" --url "<baseUrl>" --output "<name>.json"
```

Default baseUrl: `https://example.com`

**Scenario format reference:**

```json
{
  "name": "Login flow",
  "baseUrl": "https://myapp.com",
  "steps": [
    { "action": "goto", "url": "/login" },
    { "action": "fill", "selector": { "css": "[data-testid='email']", "strategy": "data-testid" }, "value": "user@test.com" },
    { "action": "click", "selector": { "css": "[data-testid='submit']", "strategy": "data-testid" } },
    { "action": "assert", "type": "title", "expected": "Dashboard" },
    { "action": "assert", "type": "visible", "selector": { "css": "[data-testid='welcome']", "strategy": "data-testid" } }
  ]
}
```

| Action | Required Fields | Description |
|--------|----------------|-------------|
| `goto` | `url` | Navigate to URL (relative to baseUrl or absolute) |
| `click` | `selector` | Click element |
| `fill` | `selector`, `value` | Clear and type into input |
| `select` | `selector`, `value` | Select dropdown option |
| `check` | `selector` | Toggle checkbox |
| `hover` | `selector` | Hover over element |
| `press` | `key` | Press keyboard key (Enter, Tab, Escape, etc.) |
| `wait` | `ms` or `selector` | Wait for time or element |
| `assert` | `type` + (`selector` and/or `expected`) | Verify condition |

**Assert types:** `visible`, `hidden`, `text`, `title`, `url`, `value`

**Selector strategies** (prefer top of list):
1. `data-testid` — `[data-testid='x']` — most stable
2. `id` — `#x` — if not auto-generated
3. `aria-label` — `[aria-label='x']`
4. `role-name` — xpath with role + text
5. `text` — xpath with text content
6. `css-path` — last resort

### `/e2e-test run <scenario.json> [--browsers chrome:128.0,firefox:130.0] [--output report.json]`

Run tests on Selenoid:

1. **Check Selenoid is running**
   ```bash
   curl -s "$SELENOID_URL/ping" || echo "Selenoid not running. Run /e2e-test setup first."
   ```

2. **Validate scenario**
   ```bash
   cd "$BRIDGE_DIR" && node dist/index.js validate "<scenario.json>"
   ```

3. **Execute**
   ```bash
   cd "$BRIDGE_DIR" && node dist/index.js run "<scenario.json>" \
     --selenoid "$SELENOID_URL" \
     --browsers "<browser-list>"
   ```

4. Report: exit code 0 = all passed, 1 = failures. Add `--output report.json` for JSON report.

### `/e2e-test status`

Check environment health:

```bash
# Docker
docker info >/dev/null 2>&1 && echo "Docker: running" || echo "Docker: stopped"

# Selenoid
curl -s "$SELENOID_URL/ping" 2>/dev/null || echo "Selenoid: stopped"

# Active sessions
curl -s "$SELENOID_URL/status" 2>/dev/null

# Browser images
docker images --format "{{.Repository}}:{{.Tag}}\t{{.Size}}" | grep selenoid

# Bridge
test -f "$BRIDGE_DIR/dist/index.js" && echo "Bridge: built" || echo "Bridge: not built"
```

### `/e2e-test stop`

Stop Selenoid and clean up:

```bash
pkill -f selenoid-test
# Optional: clean up browser containers
docker ps -q --filter "label=selenoid" | xargs -r docker rm -f
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Docker not running | `open -a Docker` (macOS) or `systemctl start docker` (Linux) |
| Session not created | Verify image exists: `docker images \| grep selenoid` |
| Connection refused :4444 | Run `/e2e-test setup` |
| Element not found | Check selector — use browser DevTools to verify |
| Wrong browser version | Update browsers.json and `pkill -HUP -f selenoid-test` to reload |

## Quick Start (for new users)

```bash
# 1. Clone the workspace (includes all submodules)
git clone --recurse-submodules https://github.com/mineclover/selenoid-workspace.git
cd selenoid-workspace

# 2. Set up environment
/e2e-test setup

# 3. Create a test
/e2e-test create "my-first-test" --url https://example.com

# 4. Edit the scenario JSON, then run
/e2e-test run my-first-test.json --browsers chrome:128.0
```
