# Browser Image Checkpoints

## Decision

Use a hybrid policy:

1. Keep a small prebuilt runtime pool for normal E2E runs.
2. Store an exact latest-stable build checkpoint for when a newer Selenoid-compatible Chrome image is needed.

This keeps day-to-day tests fast while avoiding floating `latest` inputs for custom image builds.

## Runtime Pool

The checked-in Selenoid Chrome pool uses Docker Hub prebuilt images:

- `selenoid/chrome:116.0`
- `selenoid/chrome:122.0`
- `selenoid/chrome:128.0`

These are registered in `packages/selenoid/browsers.json` and are already prepared in the local Docker cache for this workspace.

## Latest Stable Checkpoint

The latest Chrome checkpoint is stored in `docs/checkpoints/chrome-images.json`.

The checkpoint captures:

- Chrome for Testing stable version and revision
- Google Linux apt package version, filename, size, and SHA256
- Matching ChromeDriver linux64 URL
- Recommended local image tag
- Exact build command

Use the checkpoint instead of a floating `latest` build. If the upstream apt repository advances, update the checkpoint in one commit before building a new image.

The current custom latest image has been pushed as:

```text
bangjunclover/selenoid-chrome:147.0
sha256:eaee51f7ebbd9b04aa03559f9be439ffac21f673824313412ffcb40810aa024c
```

## Build From Checkpoint

```bash
cd /Users/junwoobang/workflow/selenoid-workspace/packages/images

DOCKER_DEFAULT_PLATFORM=linux/amd64 docker build \
  -t browsers/base:7.4.2 \
  selenium/base

go build -o /tmp/selenoid-images .

DOCKER_DEFAULT_PLATFORM=linux/amd64 /tmp/selenoid-images chrome \
  -b 147.0.7727.55-1 \
  -d 147.0.7727.56 \
  -t local/selenoid-chrome:147.0 \
  -t bangjunclover/selenoid-chrome:147.0
```

When running the compiled `images` binary outside this repository, set `SELENOID_IMAGES_SOURCE_DIR` to the `packages/images` repository root. Some image build contexts include nested Go modules that cannot be embedded into the parent Go binary, so the builder copies them from the source checkout when needed. Current supplemental sources are `build/static/chrome/devtools` and `build/static/safari/cmd/prism`.

Then add the image to `packages/selenoid/browsers.json`:

```json
"147.0": {
  "image": "bangjunclover/selenoid-chrome:147.0",
  "port": "4444",
  "path": "/",
  "shmSize": 2147483648,
  "tmpfs": {
    "/tmp": "size=512m"
  },
  "mem": "1g",
  "cpu": "1.0",
  "labels": {
    "pool": "e2e",
    "browser": "chrome",
    "browser-version": "147.0"
  }
}
```

Reload Selenoid after editing the config:

```bash
pkill -HUP -f selenoid-test
```

Run against the custom image:

```bash
node dist/index.js run smoke.json \
  --selenoid http://localhost:4444 \
  --browsers chrome:147.0
```

## Updating The Checkpoint

Refresh source metadata:

```bash
curl -s https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json

curl -s https://dl.google.com/linux/chrome/deb/dists/stable/main/binary-amd64/Packages.gz \
  | gunzip \
  | awk '/^Package: google-chrome-stable$/{found=1} found && /^(Version|Filename|SHA256|Size):/{print} found && /^$/{exit}'
```

Update `docs/checkpoints/chrome-images.json`, then build and smoke-test the image before adding it to the Selenoid runtime pool.
