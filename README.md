# sing-box enhance

This repository builds the latest stable upstream `sing-box` release with a
small Clash API extension. It adds a WebSocket endpoint that emits an event as
soon as a tracked connection closes.

- Build scripts and the Clash API patch live in this directory.
- [traffic-report/](traffic-report/README.md) contains the log collector and offline reports.
- Build output goes to `dist/`; the upstream checkout stays in `.cache/sing-box`.
  Both are ignored by Git.

## Build

Requirements: Git, Go, Bash, and standard shell tools.

```sh
./build.sh
```

For a Linux AMD64 binary, use the convenience wrapper:

```sh
./build_linux.sh
```

This is equivalent to `GOOS=linux GOARCH=amd64 ./build.sh`.

The script keeps an upstream checkout in `.cache/sing-box`, fetches current
release tags on every run, selects the highest stable `vX.Y.Z` tag, checks it
out in detached mode, verifies and applies the patch, tests the Clash API
package, and writes the binary to `dist/`. The cached project is retained after
the build so later builds only fetch upstream changes. On the next run, the
script reverses its own patch before switching versions. It refuses to overwrite
unrelated tracked changes in the cached checkout.

Useful overrides:

```sh
# Build a particular upstream ref.
SING_BOX_REF=v1.14.0 ./build.sh

# Cross-compile or override the upstream default build tags.
GOOS=linux GOARCH=arm64 ./build.sh
BUILD_TAGS=with_clash_api,with_quic ./build.sh

# Select another clone URL or output directory.
UPSTREAM_URL=https://github.com/SagerNet/sing-box.git OUTPUT_DIR=/tmp/out ./build.sh

# Put the persistent source cache somewhere else.
CACHE_DIR=/var/cache/sing-box-enhance ./build.sh
```

## Disconnect subscription

Enable `experimental.clash_api.external_controller` as usual, then connect to:

```text
ws://127.0.0.1:9090/connections/disconnect
```

If the Clash API has a secret, use the usual `Authorization: Bearer <secret>`
header. Browser clients that cannot set WebSocket headers can pass
`?token=<secret>`, as supported by sing-box's existing authentication middleware.

Each non-DNS connection closure produces one text frame:

```json
{
  "closedAt": "2026-08-31T12:34:56.789+08:00",
  "connection": {
    "chains": ["proxy-a", "selector"],
    "download": 456,
    "id": "fe81ad2d-7444-4b25-8504-13f138cb65f7",
    "metadata": {},
    "rule": "final",
    "rulePayload": "",
    "start": "2026-08-31T12:34:50.000+08:00",
    "upload": 123
  },
  "id": "fe81ad2d-7444-4b25-8504-13f138cb65f7"
}
```

The nested `connection` object has the same schema as entries returned by the
standard Clash `/connections` endpoint. The stream sends live events only; it
does not replay connections that closed before the WebSocket subscribed.

A plain HTTP request to this endpoint returns `426 Upgrade Required`. Existing
Clash API endpoints are unchanged.

## Collect logs and generate reports

The collector and report tool have their own npm configuration in
[traffic-report/](traffic-report/README.md). Start the collector from that directory:

```sh
cd traffic-report
./run_collector_docker.sh
```

The container runs in the background and writes daily logs to `traffic-report/logs/`.
See the [tool README](traffic-report/README.md) for the one-line Docker command,
container management, and report generation.
