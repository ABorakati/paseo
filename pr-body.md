### Linked issue

Closes #267
Closes #249

### Type of change

- [ ] Bug fix
- [x] New feature (with prior issue + design alignment)
- [ ] Refactor / code improvement
- [ ] Docs

### What does this PR do

This PR introduces real-time plan quota and account-wide usage limit tracking directly in the Paseo UI. When a user hovers the context window percentage circle, the UI tooltip now renders live quota utilization and window reset times fetched directly from the provider APIs.

#### Key Features & Technical Details:

- **Pluggable Architecture**: Implements a generic `QuotaProvider` interface and a background `QuotaFetcherService` that handles querying, caching, and WebSocket broadcasting of quota payloads.
- **Zero Configuration Auth**: Automatically resolves tokens and credentials already stored on disk from CLI configurations (e.g. `~/.claude/.credentials.json`, `~/.codex/auth.json`, local `gh/hosts.yml`, Cursor's SQLite database `state.vscdb`, Grok/Kimi settings files) or env overrides.
- **Token Refresh Flows**: Handles automatic token refresh logic for expiring Claude and Codex OAuth access tokens on 401/403 responses.
- **Security Hardening**: Replaced shell execution (`exec`) with type-safe `execFile` when querying the Cursor SQLite database via CLI to eliminate potential command injection vectors.
- **Supported Providers**:
  - **Claude**: 5-hour limit %, weekly limit % (all models, Opus, Omelette), plan name, and extra usage enablement.
  - **Codex**: primary (session) % and secondary (weekly) % usage, code review rate limits, credit balance, and plan type.
  - **GitHub Copilot**: plan type and quota reset date.
  - **Cursor**: period usage details (total, included, and bonus spend, remaining amount, and limit).
  - **Z.ai**: product subscription name, status, and validity period.
  - **Grok**: monthly limit and credit usage.
  - **Kimi**: usage limit, remaining quota, and next reset time.

### How did you verify it

- **Automated Tests**:
  - Ran the unit test suite covering credential resolution, API mocks, OAuth token refresh flows, and broadcast deduplication:
    ```bash
    npx vitest run packages/server/src/services/quota-fetcher.test.ts --bail=1
    ```
    _Result:_ **15/15 tests passed** successfully.
- **Verification Commands**:
  - Verified compilation: `npm run typecheck` passes cleanly.
  - Verified formatting: `npm run format` successfully ran Biome formatter.
- **Manual Verification**:
  - Ran daemon and web/mobile client in the dev environment. Hovered the context circle during active Claude and Codex sessions and verified that the tooltip displays the correct plan titles, progress bars for each window (5-hour, weekly, etc.), and resets-at indicators.

### Checklist

- [x] One focused change. Unrelated cleanups split out.
- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] `npm run format` ran (Biome)
- [ ] UI changes include screenshots or video for every affected platform
- [x] Tests added or updated where it made sense
