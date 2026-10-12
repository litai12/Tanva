# ToAPIs image model registration

Independent GORM command for SQLite, MySQL and PostgreSQL. It does not start the
gateway, run schema migrations, call a generation API or create a new channel.
It requires an existing type `59` channel at `https://toapis.cn`; production uses
channel `31`. Read credentials from `SQL_DSN` in the process environment, never
from command arguments. SQL logging is disabled and database errors are redacted.

From `new-api/`:

```sh
go test ./cmd/register-toapis-image-models
go build -o /tmp/register-toapis-image-models ./cmd/register-toapis-image-models
# SQL_DSN must already be set in the execution environment.
/tmp/register-toapis-image-models --driver=postgres --channel-id=31
/tmp/register-toapis-image-models --driver=postgres --channel-id=31 --apply --backup-dir=/secure/backup/toapis-images
```

The default prints a read-only JSON plan. `--apply` requires a backup directory
with mode `0700` (a missing directory is created with that mode). A unique `0600`
JSON backup is flushed to disk before writes. It stores the original channel
fields, affected model rows, selected channel's abilities and `ModelPrice`; it
never selects or writes channel keys/settings. Keep a native database backup as
well for a complete operational restore. The JSON snapshot supports manual
restoration of only this command's affected fields; do not replay it over newer
administrator changes without checking them.

All writes run in one transaction. The command appends exactly these SKUs to
the selected channel and merges only their prices into the existing numeric
`ModelPrice` object:

| New SKU | Catalog source | Base CNY |
| --- | --- | ---: |
| `gpt-image-2.5-flare-vip` | `gpt-image-2.5-flare` | 0.2 |
| `gpt-image-2.5-sunburst-vip` | `gpt-image-2.5-sunburst` | 0.2 |
| `gemini-nano-banana-2.1` | `gemini-3.1-flash-image-preview` | 0.3 |

Existing target prices are corrected to these values and reported in the plan.
The runtime adapter supplies the model-specific resolution/quality multipliers;
this tool does not change group ratios or other price keys.

New catalog rows copy the source vendor/icon/endpoints/status, preserve all
source capabilities and add the supported `reference_images` capability (legacy
source capability lists may be empty). They
use exact model names with independent parameter definitions. Existing target
rows preserve administrator descriptions, vendor, status and other metadata;
only kind, capabilities and parameter definitions are updated when needed.

VIP form parameters expose ten aspect ratios, `1K/2K/4K` resolution and five
quality levels (`low/medium/high/xhigh/max`), defaulting to `1:1`, `1K`, `high`.
The adapter also accepts explicit pixel sizes such as `1536x1024` through the
API; do not combine explicit pixel dimensions with a conflicting resolution.
Nano exposes fourteen ratios, `resolution=1K/2K/4K`, default `1:1/1K` and at most
fourteen remote image references. Its adapter maps resolution to the upstream
`metadata.resolution`. Both models generate one image per request (`n=1`).

Only missing target abilities are inserted. They inherit the selected channel's
groups, priority, weight and tag; enabled state requires an enabled channel and,
when present, an enabled source ability in that group. Existing target abilities
are retained, including manually disabled records. Disabled channels remain
disabled. A second identical apply reports no actions and writes no backup.
Stop competing administrative changes while applying, then restart new-api to
refresh channel/catalog/pricing caches after the matching runtime deployment.
