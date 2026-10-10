# Traffic collector and report

Collect sing-box disconnect events into daily JSONL files, then generate an
offline report with hourly totals and the top five domains for each hour.

All commands below run from this directory:

```sh
cd traffic-report
```

## Collect with Docker

Requires Docker and Bash. Node.js runs inside the container.

```sh
./run_collector_docker.sh
```

The script runs this command:

```sh
docker run -d --init --restart unless-stopped -v "$(pwd):/app" -w /app -e "CLASH_WS_URL=${CLASH_WS_URL:-ws://192.168.2.3:9090/connections/disconnect}" node:22-alpine node disconnect-collector.mjs
```

Only `CLASH_WS_URL` is passed through by the startup script. To change the endpoint:

```sh
CLASH_WS_URL=ws://192.168.2.3:9090/connections/disconnect ./run_collector_docker.sh
```

The command prints a container ID and returns immediately. The entire current
directory is mounted at `/app`, so run it from `traffic-report/`.
Logs are written to `/app/logs`, which is the local `logs/` directory.

The container restarts automatically unless manually stopped. Each invocation
creates a new container; use the existing container ID to manage it:

```sh
docker logs -f <container-id>
docker stop <container-id>
docker start <container-id>
```

## Generate a report

With Node.js 22 or newer installed locally:

```sh
npm run report -- logs/disconnect-2026-10-10.jsonl
```

Replace the filename with an existing log. Older unsplit logs are also supported:

```sh
node traffic-report.mjs logs/disconnect.jsonl
```

Or generate a report entirely in Docker:

```sh
docker run --rm -v "$(pwd):/app:ro" -w /app node:22-alpine node traffic-report.mjs logs/disconnect-2026-10-10.jsonl
```

To save a local report:

```sh
node traffic-report.mjs logs/disconnect-2026-10-10.jsonl > report.txt
```

Reports read only the specified file and make no API requests. Relative paths
are resolved from the current working directory; absolute paths also work.

Each hour shows aligned download, upload, total traffic, and connection counts.
Its children are the top five named domains ranked by total traffic, with no
minimum threshold. Connections without a domain count toward the hour total
but do not appear among its children. Active connections are not included.

## Log dates and hourly totals

- Files use the collection date: `logs/disconnect-YYYY-MM-DD.jsonl`.
  The first event after midnight opens a new file. Restarts append to that day's file.
- The Docker collector uses UTC. Local collection and reports use the local
  timezone. Use the Docker report command to match the collector's UTC timezone.
- Hourly totals use `closedAt`, falling back to `collectedAt` when absent.
  The report displays the timezone offset beside each hour.
- All traffic from a connection is assigned to its closing hour. These logs
  cannot measure how that traffic was distributed across several hours.
- Invalid JSON lines and records without usable timestamps are counted separately.
  The `logs/` directory is ignored by Git.

## Run locally

Requires Node.js 22 or newer. No npm dependency installation is needed.

```sh
npm start
# Override the endpoint:
CLASH_WS_URL=ws://192.168.2.3:9090/connections/disconnect npm start
# Check both scripts:
npm run check
```

The collector reconnects automatically and only writes logs. Generate reports
separately with the commands above.
