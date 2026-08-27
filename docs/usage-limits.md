# Usage Limits

Usage limit plugins let Paseo show quota, balance, and rate-limit state for any provider — first-party or not — driven entirely by `config.json`.

A plugin declares two things:

1. **Where to get a JSON document** — an HTTP endpoint, or a local command that prints JSON on stdout.
2. **Which JSON paths inside that document** carry the used / limit / remaining / percent / reset values.

That is the whole model. Adding a provider Paseo has never heard of requires no code change and no release — only a config edit.

---

## Table of Contents

- [Config location and shape](#config-location-and-shape)
- [Plugin entry reference](#plugin-entry-reference)
- [Source reference](#source-reference)
- [Readings](#readings)
- [Units](#units)
- [JSON paths](#json-paths)
- [Environment interpolation](#environment-interpolation)
- [Presets](#presets)
- [Recipes](#recipes)
- [Refresh](#refresh)
- [Where it shows up](#where-it-shows-up)
- [Troubleshooting](#troubleshooting)

---

## Config location and shape

Plugins live under the top-level `usageLimits` key in `config.json` (`$PASEO_HOME/config.json`, typically `~/.paseo/config.json`):

```json
{
  "version": 1,
  "usageLimits": {
    "plugins": {
      "plugin-id": {
        "label": "My Provider",
        "source": { "kind": "http", "url": "https://api.example.com/usage" },
        "readings": [
          {
            "kind": "balance",
            "id": "credits",
            "label": "Credits",
            "unit": "usd",
            "remainingPath": "credits.remaining"
          }
        ]
      }
    }
  }
}
```

Plugin IDs must be lowercase alphanumeric with hyphens (`/^[a-z][a-z0-9-]*$/`).

Every entry must supply either a `preset` or both `label` and `readings`. A missing one is a config validation error naming the plugin ID. An entry that names a preset which does not exist, or that otherwise fails to resolve into a complete plugin, is surfaced in the UI as a plugin with an error — it does not silently disappear.

---

## Plugin entry reference

Each entry under `usageLimits.plugins`:

| Field               | Type                    | Required        | Default  | Description                                                                                              |
| ------------------- | ----------------------- | --------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `preset`            | `string`                | No              | —        | Built-in preset ID to start from; other fields override it                                               |
| `label`             | `string`                | Yes (no preset) | —        | Display name in the UI                                                                                   |
| `description`       | `string`                | No              | —        | Short description shown under the label                                                                  |
| `providerId`        | `string`                | No              | —        | Links to an `agents.providers` entry so the UI can share its icon                                        |
| `enabled`           | `boolean`               | No              | `true`   | Set to `false` to skip the plugin                                                                        |
| `refreshIntervalMs` | `number` (int)          | No              | `300000` | Cache TTL. Min `30000` (30s), max `86400000` (24h)                                                       |
| `source`            | `UsageLimitSource`      | No              | —        | Where the JSON document comes from. Omit only when every reading is schedule-driven and needs no request |
| `readings`          | `UsageReadingMapping[]` | Yes (no preset) | —        | At least one entry. See [Readings](#readings)                                                            |

---

## Source reference

`source` is a discriminated union on `kind`.

### `kind: "http"`

| Field     | Type                     | Required | Default | Description                                    |
| --------- | ------------------------ | -------- | ------- | ---------------------------------------------- |
| `kind`    | `"http"`                 | Yes      | —       | Discriminator                                  |
| `url`     | `string`                 | Yes      | —       | Endpoint returning JSON                        |
| `method`  | `"GET" \| "POST"`        | No       | `"GET"` | HTTP method                                    |
| `headers` | `Record<string, string>` | No       | `{}`    | Request headers — where credentials go         |
| `body`    | `unknown` (JSON)         | No       | —       | JSON request body, serialized as-is. POST only |

### `kind: "command"`

| Field     | Type        | Required | Default | Description                                                        |
| --------- | ----------- | -------- | ------- | ------------------------------------------------------------------ |
| `kind`    | `"command"` | Yes      | —       | Discriminator                                                      |
| `command` | `string[]`  | Yes      | —       | argv, at least one element. Must print a single JSON doc on stdout |
| `cwd`     | `string`    | No       | —       | Working directory for the command                                  |

---

## Readings

Providers do not all measure the same thing, so `readings` is a list of entries discriminated on `kind`:

| Kind      | For                                                           |
| --------- | ------------------------------------------------------------- |
| `quota`   | An amount used against a ceiling inside a resetting window    |
| `balance` | Money or credits left, optionally against a starting total    |
| `rate`    | Which pricing band is in force right now, and when it changes |

Every reading shares these fields:

| Field   | Type     | Required | Description                                               |
| ------- | -------- | -------- | --------------------------------------------------------- |
| `kind`  | `string` | Yes      | `"quota"`, `"balance"`, or `"rate"`                       |
| `id`    | `string` | Yes      | Stable identifier for this reading within the plugin      |
| `label` | `string` | Yes      | Display name                                              |
| `group` | `string` | No       | Groups readings inside one plugin (e.g. per model family) |

### `kind: "quota"`

| Field           | Type                 | Required | Description                                |
| --------------- | -------------------- | -------- | ------------------------------------------ |
| `unit`          | `UsageLimitUnit`     | Yes      | See [Units](#units)                        |
| `window`        | `UsageWindowMapping` | No       | The resetting window this quota belongs to |
| `usedPath`      | `string`             | No       | Path to the amount consumed                |
| `limitPath`     | `string`             | No       | Path to the ceiling                        |
| `remainingPath` | `string`             | No       | Path to the amount left                    |
| `percentPath`   | `string`             | No       | Path to a 0-100 percentage                 |

Give a quota enough paths to place itself on a scale: `usedPath` with one of `limitPath` / `remainingPath`, or `percentPath` on its own. The resolved reading carries `used`, `limit`, `remaining`, and `percent` (0-100, taken from `percentPath` or derived from whichever pair resolved) — any of them can be `null`.

`window`:

| Field          | Type     | Required | Description                               |
| -------------- | -------- | -------- | ----------------------------------------- |
| `label`        | `string` | Yes      | Names the window: `"5 hours"`, `"Weekly"` |
| `resetsAtPath` | `string` | No       | Path to when the window rolls over        |

`resetsAtPath` accepts an ISO timestamp, epoch seconds, or epoch milliseconds — all three normalize to an ISO string.

### `kind: "balance"`

| Field           | Type             | Required | Description                                          |
| --------------- | ---------------- | -------- | ---------------------------------------------------- |
| `unit`          | `UsageLimitUnit` | Yes      | See [Units](#units)                                  |
| `remainingPath` | `string`         | No       | Path to the amount left                              |
| `totalPath`     | `string`         | No       | Starting balance, so a percentage remaining can show |
| `percentPath`   | `string`         | No       | Path to a 0-100 percentage                           |
| `currencyPath`  | `string`         | No       | Path to a currency code                              |

A bare `remainingPath` (a prepaid balance with no ceiling) renders as a number without a bar.

### `kind: "rate"`

A rate reading has one required field, `resolution`, discriminated on `via`.

**`via: "response"`** — the document itself says which band is active:

| Field            | Type     | Required | Description                     |
| ---------------- | -------- | -------- | ------------------------------- |
| `statePath`      | `string` | Yes      | Path to the current band's name |
| `multiplierPath` | `string` | No       | Path to the price multiplier    |
| `changesAtPath`  | `string` | No       | Path to when the band changes   |
| `detailPath`     | `string` | No       | Path to a free-text detail line |

**`via: "schedule"`** — Paseo works out the active band from a wall-clock schedule, no request needed:

| Field               | Type                | Required | Default      | Description                             |
| ------------------- | ------------------- | -------- | ------------ | --------------------------------------- |
| `timeZone`          | `string`            | No       | `"UTC"`      | IANA zone the window times are given in |
| `windows`           | `UsageRateWindow[]` | Yes      | —            | At least one band                       |
| `defaultLabel`      | `string`            | No       | `"Standard"` | Applies whenever no window is active    |
| `defaultMultiplier` | `number`            | No       | `1`          | Multiplier when no window is active     |

Each entry in `windows`:

| Field        | Type     | Required | Description                               |
| ------------ | -------- | -------- | ----------------------------------------- |
| `label`      | `string` | Yes      | Band name, e.g. `"Off-peak"`              |
| `start`      | `string` | Yes      | `HH:MM` wall clock, 24-hour               |
| `end`        | `string` | Yes      | `HH:MM` wall clock, 24-hour               |
| `multiplier` | `number` | No       | Price multiplier while the band is active |
| `detail`     | `string` | No       | Free-text detail line                     |

---

## Units

`unit` applies to `quota` and `balance` readings.

| Unit       | Rendered as                    |
| ---------- | ------------------------------ |
| `tokens`   | Token counts                   |
| `requests` | Request counts                 |
| `credits`  | Provider-specific credit units |
| `usd`      | Dollar amounts                 |
| `percent`  | A percentage                   |

---

## JSON paths

Paths are dot/bracket paths into the parsed JSON document:

```
data.usage
balance_infos[0].total_balance
rate_limits.primary.remaining
```

- Numeric strings are coerced to numbers, so `"110.00"` and `110.0` both work.
- A path that does not resolve yields `null` for that field, not an error. A missing field is a normal outcome. A plugin whose paths are all wrong reports `ok` with every value `null` — see [Troubleshooting](#troubleshooting).

---

## Environment interpolation

`${VAR}` inside `url`, `headers` values, `body`, and `command` entries is replaced with the daemon process's environment variable of that name.

```json
{
  "headers": { "Authorization": "Bearer ${DEEPSEEK_API_KEY}" }
}
```

This keeps API keys out of `config.json` — put them in the daemon's environment instead. A variable that is unset (or set to an empty string) makes the plugin report an error rather than sending an empty credential, because an empty bearer token produces a confusing 401 instead of a legible "set `DEEPSEEK_API_KEY`".

The variable must be set in the **daemon's** environment, not in the shell you happen to be typing in.

---

## Presets

A preset is a pre-filled plugin definition. Use one with `{"preset": "<id>"}`; any other field on the same entry overrides the preset's value.

| Preset       | Label      | Env var              | Reports                                                             |
| ------------ | ---------- | -------------------- | ------------------------------------------------------------------- |
| `deepseek`   | DeepSeek   | `DEEPSEEK_API_KEY`   | Two `balance` readings — prepaid balance and granted credit, in USD |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` | One `quota` reading — credits used against the current key's limit  |

Only endpoints backed by published, stable provider documentation ship as presets. Everything else is a hand-written entry — see [Recipes](#recipes).

---

## Recipes

### DeepSeek (preset)

```json
{
  "usageLimits": {
    "plugins": {
      "deepseek": { "preset": "deepseek" }
    }
  }
}
```

Set `DEEPSEEK_API_KEY` in the daemon's environment. To poll less often, override on the same entry:

```json
{
  "usageLimits": {
    "plugins": {
      "deepseek": { "preset": "deepseek", "refreshIntervalMs": 1800000 }
    }
  }
}
```

### DeepSeek off-peak discount (template)

A `rate` reading resolved `via: "schedule"` needs no request at all, so a plugin made only of schedule-driven rates can omit `source` entirely — no endpoint, no credentials.

> The window times and multiplier below are a **template**. Confirm the current off-peak hours, time zone, and discount against DeepSeek's own pricing page before relying on them.

```json
{
  "usageLimits": {
    "plugins": {
      "deepseek-pricing": {
        "label": "DeepSeek pricing",
        "providerId": "deepseek",
        "readings": [
          {
            "kind": "rate",
            "id": "band",
            "label": "Current rate",
            "resolution": {
              "via": "schedule",
              "schedule": {
                "timeZone": "UTC",
                "windows": [
                  {
                    "label": "Off-peak",
                    "start": "16:30",
                    "end": "00:30",
                    "multiplier": 0.5,
                    "detail": "Discounted pricing"
                  }
                ],
                "defaultLabel": "Standard",
                "defaultMultiplier": 1
              }
            }
          }
        ]
      }
    }
  }
}
```

When the provider reports the active band in its own response instead, use `via: "response"` with `statePath` and drop the schedule.

### OpenRouter (preset)

```json
{
  "usageLimits": {
    "plugins": {
      "openrouter": { "preset": "openrouter" }
    }
  }
}
```

Set `OPENROUTER_API_KEY` in the daemon's environment.

### Generic OpenAI-compatible credit endpoint

Many gateways expose a credits or usage endpoint. The URL and paths below are **placeholders** — confirm both against your provider's own API documentation before using them.

```json
{
  "usageLimits": {
    "plugins": {
      "my-gateway": {
        "label": "My Gateway",
        "description": "Prepaid credits",
        "providerId": "my-codex",
        "source": {
          "kind": "http",
          "url": "https://<your-gateway-host>/v1/credits",
          "method": "GET",
          "headers": { "Authorization": "Bearer ${MY_GATEWAY_API_KEY}" }
        },
        "readings": [
          {
            "kind": "quota",
            "id": "credits",
            "label": "Credits",
            "unit": "usd",
            "usedPath": "data.total_usage",
            "limitPath": "data.total_granted"
          }
        ]
      }
    }
  }
}
```

### Antigravity subscription (template)

> Paseo ships **no preset** for Antigravity and its endpoint has not been verified here. The URL and every path below are placeholders — substitute the real endpoint and response paths from Antigravity's own documentation before this will return anything.

Allowances split by model family, each family with its own 5-hour and weekly bucket — one `group` per family, one reading per window:

```json
{
  "usageLimits": {
    "plugins": {
      "antigravity": {
        "label": "Antigravity",
        "description": "Subscription quota",
        "source": {
          "kind": "http",
          "url": "https://<antigravity-api-host>/<subscription-usage-path>",
          "method": "GET",
          "headers": { "Authorization": "Bearer ${ANTIGRAVITY_API_KEY}" }
        },
        "readings": [
          {
            "kind": "quota",
            "id": "gemini-5h",
            "label": "Gemini models",
            "group": "Google models",
            "unit": "requests",
            "window": { "label": "5 hours", "resetsAtPath": "<path.to.reset>" },
            "usedPath": "<path.to.used>",
            "limitPath": "<path.to.limit>"
          },
          {
            "kind": "quota",
            "id": "gemini-weekly",
            "label": "Gemini models",
            "group": "Google models",
            "unit": "requests",
            "window": { "label": "Weekly", "resetsAtPath": "<path.to.weekly.reset>" },
            "usedPath": "<path.to.weekly.used>",
            "limitPath": "<path.to.weekly.limit>"
          },
          {
            "kind": "quota",
            "id": "other-5h",
            "label": "Other models",
            "group": "Other models",
            "unit": "requests",
            "window": { "label": "5 hours", "resetsAtPath": "<path.to.other.reset>" },
            "usedPath": "<path.to.other.used>",
            "limitPath": "<path.to.other.limit>"
          },
          {
            "kind": "quota",
            "id": "other-weekly",
            "label": "Other models",
            "group": "Other models",
            "unit": "requests",
            "window": { "label": "Weekly", "resetsAtPath": "<path.to.other.weekly.reset>" },
            "usedPath": "<path.to.other.weekly.used>",
            "limitPath": "<path.to.other.weekly.limit>"
          }
        ]
      }
    }
  }
}
```

### OpenCode Zen key (template)

> Paseo ships **no preset** for OpenCode Zen and its endpoint has not been verified here. The URL and every path below are placeholders — substitute the real endpoint and response paths from OpenCode's own documentation.

```json
{
  "usageLimits": {
    "plugins": {
      "opencode-zen": {
        "label": "OpenCode Zen",
        "description": "API key balance",
        "providerId": "opencode",
        "source": {
          "kind": "http",
          "url": "https://<opencode-zen-api-host>/<key-usage-path>",
          "method": "GET",
          "headers": { "Authorization": "Bearer ${OPENCODE_ZEN_API_KEY}" }
        },
        "readings": [
          {
            "kind": "balance",
            "id": "balance",
            "label": "Balance",
            "unit": "usd",
            "remainingPath": "<path.to.remaining>",
            "totalPath": "<path.to.total>"
          }
        ]
      }
    }
  }
}
```

### Command source (template)

When a provider ships a CLI that already knows how to authenticate, let it do the work. The command must print a single JSON document on stdout. The argv and paths below are a template — check what your CLI actually prints.

```json
{
  "usageLimits": {
    "plugins": {
      "opencode-cli": {
        "label": "OpenCode",
        "providerId": "opencode",
        "refreshIntervalMs": 600000,
        "source": {
          "kind": "command",
          "command": ["opencode", "usage", "--json"],
          "cwd": "/home/user"
        },
        "readings": [
          {
            "kind": "balance",
            "id": "balance",
            "label": "Balance",
            "unit": "usd",
            "remainingPath": "<path.to.remaining>"
          }
        ]
      }
    }
  }
}
```

---

## Refresh

`refreshIntervalMs` is the cache TTL for a plugin — how long a fetched result is served before the daemon goes back to the source. Minimum 30 seconds, maximum 24 hours, default 5 minutes (`300000`).

Results are cached in the daemon and shared across every connected client, so five open devices do not mean five times the API calls. The app also has a manual refresh button that refetches immediately, either for one plugin or for all of them.

Pick an interval that suits the endpoint. Balance endpoints move slowly; 30 minutes is plenty.

---

## Where it shows up

Settings → Usage in the app.

This requires a daemon that advertises the `usageLimits` feature. Older daemons show "Update the host to see usage limits." — there is no fallback path, the host upgrade is the fix.

---

## Troubleshooting

**The plugin shows an error.** Usually an unset environment variable. `${VAR}` resolves against the **daemon's** environment, not the shell you ran the check in — restart the daemon with the variable exported, or set it wherever the daemon is launched from. Auth failures from the endpoint itself surface here too.

**All values are `null`.** The paths don't match the response. Dump the raw document and re-derive them:

```bash
curl -s -H "Authorization: Bearer $MY_API_KEY" https://api.example.com/usage | jq .
```

Then map each field with dot/bracket syntax — remember array indices (`balance_infos[0].total_balance`).

**A command source fails.** The command must print a single JSON document on stdout and nothing else; log lines or progress output on stdout break parsing (send those to stderr). A non-zero exit is reported as an error.

---

See [docs/custom-providers.md](custom-providers.md) for configuring the provider itself, and [docs/rpc-namespacing.md](rpc-namespacing.md) for the `usage.limits.*` RPC pair.
