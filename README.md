# @kneel/babybuddy

A consolidated [swamp](https://github.com/swamp-club/swamp) model for
[Baby Buddy](https://github.com/babybuddy/babybuddy). One model type reads recent
activity (`sync`) and writes new entries (`log-feeding`, `log-diaper`,
`log-sleep`, `log-pumping`, `log-tummy-time`, `log-note`, `log-temperature`,
`log-medication`) against a Baby Buddy instance's REST API. A bundled
`daily-summary` report turns the latest sync into a per-day digest of sleep,
feedings, diapers, pumping, and weight. Payloads mirror the `babybuddy-mcp`
server so both tools agree on how data is written.

## Prerequisites

- A running Baby Buddy instance and an API token
  (Settings → **API** in Baby Buddy).
- The token stored in a swamp vault (never hard-code it in the model).

## Installation

```sh
swamp extension pull @kneel/babybuddy
```

## Setup

Store the token in a vault, then create a model instance that references it:

```sh
# Store the API token
swamp vault store bb-secrets BABYBUDDY_TOKEN "<your-token>"

# Create the tracker, wiring the token from the vault
swamp model create @kneel/babybuddy connor \
  --global-arg baseUrl=https://baby.example.com \
  --global-arg 'token=${{ vault.get("bb-secrets", "BABYBUDDY_TOKEN") }}'
```

If `childId` is omitted, the first child on the instance is used.

## Usage

```sh
# Pull the last 7 days of activity into the `entries` data snapshot
swamp model method run connor sync --input sinceHours=168

# Log a bottle feeding of 90ml over the last 15 minutes
swamp model method run connor log-feeding \
  --input method=bottle --input type=formula \
  --input amount=90 --input durationMinutes=15

# View the consolidated daily summary produced after sync
swamp report get @kneel/babybuddy-daily-summary --model connor --markdown
```

## Reports

Every `sync` produces all of these (read any with
`swamp report get @kneel/babybuddy-<name> --model <model> --markdown`):

- `daily-summary` — consolidated per-day digest
- `sleep-totals` — daily sleep with nap vs night split
- `sleep-longest-stretch` — longest/average consecutive block per day
- `sleep-feeding-correlation` — sleep hours vs feeding count/volume
- `feeding-amounts` — daily counts and volume (breast vs bottle)
- `feeding-duration` — average and total feeding duration per day
- `feeding-intervals` — time between feedings, with recent gaps
- `diaper-types` — daily wet/solid breakdown with colors
- `diaper-intervals` — time between diaper changes
- `pumping-amounts` — daily totals, sessions, and averages
- `weight-feeding-correlation` — weight trajectory vs feeding volume
- `temperature` — all readings in °C and °F
- `tummy-time` — daily totals and session counts

Each report summarizes whatever window the last `sync` pulled (default 7 days).

## How it works

`sync` fans out concurrent reads across every tracked Baby Buddy endpoint and
stores the results as a single `entries` resource. Each `log-*` method POSTs a
new record and stores the created entry as a `logged` resource so swamp keeps a
versioned history of everything written. The `daily-summary` report reads the
most recent `entries` snapshot, groups records by date, and renders both
markdown and JSON. The API token is read at runtime via `vault.get()` — it is
never stored in the model definition.

## License

MIT — see LICENSE for details.
