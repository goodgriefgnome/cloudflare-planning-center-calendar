# Planning Center Calendar for Cloudflare

A reusable, themeable event-list embed powered by Planning Center Calendar, Cloudflare Workers, and Workers KV. MIT licensed.

The calendar has a month navigator and a continuous list grouped by month and day. Location and registration appear directly in each event row. Public descriptions appear directly below each event; for repeated occurrences of the same parent event, only the first displayed occurrence shows its description. All titles are ordinary text. It uses a web component with Shadow DOM, with CSS custom properties and `::part()` hooks for custom styling. No frontend framework, visitor login, cookies, database, or client-side credentials are required.

## Architecture

```text
Visitors:
  Your website → embed.js → <church-calendar> → Worker /api/events → KV

When a snapshot is at least 15 minutes old:
  Serve that cached snapshot immediately
  Worker waitUntil → Planning Center → publication filter → replace KV only on success

Only when no successful snapshot exists:
  The first request waits for Planning Center
```

One deployment connects to **one Planning Center organisation**. The default date window is the next calendar year, including events currently in progress. Individual occurrences come from Planning Center; the embed does not generate recurrence rules itself.

The module script and API are hosted by your Worker. The component derives its default API URL from its module URL, not from the embedding website. An explicit `api-url` attribute can override it. `/` serves a standalone calendar using the same component.

## Local preview without credentials

Requires Node.js 22 or later and npm.

```sh
npm ci
npm run demo
```

Open the local URL printed by Wrangler. Sample mode shows a visible demonstration notice. It does not read or write Planning Center data. The demo command only overrides the local Worker variable; `DEMO_MODE` remains `false` in the checked-in production config.

```sh
npm run check
npm test
npm run build
```

`build` bundles a deployment with Wrangler's dry-run mode; it does not publish anything. Tests cover publication rules, public schedules, cancellations, restricted resources, pagination, auth failures, snapshot replacement, stale-cache retention, CORS, daylight saving, and all-day dates. CI runs these checks on pushes and pull requests.

The suite also runs the Planning Center client inside Cloudflare's local Workers runtime (Miniflare/workerd), with outbound requests intercepted. This checks runtime-specific fetch options and verifies that redirects are rejected without forwarding credentials. It needs no real API credentials or external requests.

Automated checks cover request-driven background refresh, retention after failures, snapshot timestamps, publication, and API behaviour. The Wrangler deployment dry run is also checked. Browser QA is still pending because the development environment's preview relay timed out. Before launch, check desktop and mobile layouts, keyboard date navigation and inline recurring descriptions, and a cross-origin embed on the actual website, then compare events against your real Planning Center account.

## Deploy to your own Cloudflare account

### 1. Authenticate and create storage

```sh
npx wrangler login
npx wrangler kv namespace create CALENDAR
```

For a new installation, replace `kv_namespaces[0].id` in `wrangler.jsonc` with the namespace ID returned by Cloudflare. This repository is already configured with the namespace supplied for the St John’s deployment. Local development uses local KV rather than the production namespace.

### 2. Configure the deployment

Edit `wrangler.jsonc`:

| Setting | Meaning |
| --- | --- |
| `name` | Your Worker name |
| `TIMEZONE` | Source calendar timezone; default `Australia/Sydney` |
| `ALLOWED_ORIGINS` | Comma-separated exact origins permitted to call the API from a browser; no wildcard or trailing slash |
| `FALLBACK_URL` | Legacy API metadata; the component no longer displays a Church Center link |
| `PCO_USER_AGENT` | Identifies the application and supplies a contact URL/email |
| `PCO_API_VERSION` | Pinned to stable `2026-06-22`; the linked `2026-10-19` documentation was beta when this was written |
| Refresh threshold | 15 minutes; older successful snapshots remain available with no age cutoff |
| `DEMO_MODE` | Keep `false` in production |
| `triggers.crons` | Empty: no scheduled refreshes |

The supplied origin and fallback values are an example deployment for St John's Darlinghurst. The component and backend naming are general. Replace those values when reusing this project.

Add your custom domain inside the config, or configure it in the Cloudflare dashboard after deployment:

```jsonc
"routes": [
  { "pattern": "calendar.stjohnsanglican.org.au", "custom_domain": true }
]
```

For the dashboard route, open **Workers & Pages → your Worker → Settings → Domains & Routes → Add → Custom Domain**. The domain must be in your Cloudflare account. Dashboard labels can change. No Sites service or separate Cloudflare Pages project is needed.

### 3. Set Planning Center secrets

Create a Personal Access Token in your [Planning Center developer account](https://api.planningcenteronline.com/). Its owner needs Calendar read access to the events you want to publish. Use the minimum appropriate permissions. Planning Center permissions follow the account owner; this is not a separate read-only token scope.

```sh
npx wrangler secret put PCO_APPLICATION_ID
npx wrangler secret put PCO_SECRET
```

Paste each value only into the corresponding interactive secret prompt. Never put secrets in `wrangler.jsonc`, HTML, the repository, or an iframe URL. If Wrangler asks to create the named Worker before setting secrets, allow it to create that Worker.

For local real-data testing, copy `.dev.vars.example` to `.dev.vars` and set the two values there. This file is ignored by Git. `npm run dev` uses real-data mode; opening the calendar fetches the first snapshot on demand. No scheduler URL is needed.

### 4. Publish and check the first refresh

```sh
npm run deploy
npx wrangler tail
```

Open the calendar or `/api/events` to trigger the first refresh. A cold start waits for Planning Center before displaying results. Thereafter, visits serve the last successful snapshot immediately. Once it is at least 15 minutes old, a visit also starts a refresh in the background using `ctx.waitUntil()`. A failed refresh leaves the existing snapshot and its timestamp unchanged.

`/health` reports whether a usable successful snapshot exists, along with `stale`, `generatedAt`, and `fetchedAt`. It never triggers a refresh. An old snapshot remains healthy/available; the `stale` flag tells you it is due for refresh. Before the first successful fetch, `/health` returns HTTP 503. An empty calendar (`events: []`) is a valid successful snapshot.

### Moving from the earlier cron version

Redeploy the latest `main` commit through **Workers & Pages → your Worker → Builds/Deployments**. The checked-in empty `triggers.crons` configuration removes the old schedule during deployment. If a trigger still appears under **Settings → Triggers → Cron Triggers**, delete it there. Keep the existing KV namespace and the two runtime secrets; no new Cloudflare service is required. Reload the embedding webpage to load the updated component.

For dashboard-only initial deployment, connect the repository in **Workers & Pages → Create application → GitHub**, name the Worker `planning-center-calendar`, leave the build command blank, and retain the default deploy command. Add `PCO_APPLICATION_ID` and `PCO_SECRET` as **Secret** values under the Worker's **Settings → Variables and Secrets**, not as build variables. Domains and the website embed are configured as described below.

### 5. Embed on your website

Paste this into a custom HTML/JavaScript block, changing the hostname as needed:

```html
<script type="module" src="https://calendar.stjohnsanglican.org.au/embed.js"></script>
<church-calendar></church-calendar>
```

See [examples/stjohns.html](examples/stjohns.html) for the branded configuration. If the website has a Content Security Policy, allow the calendar origin under `script-src` and `connect-src`. The component injects a stylesheet into its shadow root; the host CSP must allow that style (commonly through `style-src 'unsafe-inline'`). A stricter nonce-only host policy needs a corresponding stylesheet/nonce adaptation before use.

For a cross-origin local test, add the exact local host origin to `ALLOWED_ORIGINS` and use `api-url` if serving the component from another development origin. Plain HTTP is supported for local preview; production links require HTTPS.

## Customisation

The standalone `/` page and the script embed use exactly the same calendar component. The standalone header/footer are outside the component; website fonts, theme overrides, available width and the example's internal scrolling can change its surrounding appearance.

```html
<church-calendar
  timezone="Australia/Sydney"
  style="
    --calendar-font-family: inherit;
    --calendar-text: #101729;
    --calendar-background: #ffffff;
    --calendar-border-radius: 6px;
  "
></church-calendar>
```

The `timezone` attribute overrides timed-event display, defaulting to the snapshot timezone. All-day dates always retain the source calendar dates. Change `TIMEZONE` on the Worker if the source calendar itself uses another timezone.

| CSS property | Default / purpose |
| --- | --- |
| `--calendar-font-family` | `inherit` |
| `--calendar-font-size` | `1rem` |
| `--calendar-text` | `#101729` |
| `--calendar-muted` | 70% text / 30% background |
| `--calendar-accent` | Follows `--calendar-text`; override for a separate link/focus colour |
| `--calendar-background` | `#fff` |
| `--calendar-surface` | 4% text / 96% background |
| `--calendar-border` | 15% text / 85% background |
| `--calendar-border-radius` | `.375rem` |
| `--calendar-padding` | `1rem` |
| `--calendar-gap` | `3rem` |
| `--calendar-sticky-offset` | `1rem`; increase to clear a fixed website header |

Muted, surface and border defaults use `color-mix(in srgb, …)` with `--calendar-text` and `--calendar-background`, so changing either base colour also updates the derived colours. Explicit overrides still take precedence. For example:

```css
--calendar-text: #202020;
--calendar-background: #ffffff;
/* Optional: replace the derived border colour. */
--calendar-border: #cccccc;
```

The picker has no hover background, selected-date fill or today outline. Today remains bold, event dots remain, and keyboard focus is visible. Its date buttons jump to the list rather than representing a selection that tracks scrolling. All displayed dates on or after today are clickable, including dates from adjacent months. Adjacent-month dates have the same faded appearance as disabled dates, while future dates retain their click action and keyboard access. Dates beyond the fetched window may have no corresponding event to jump to. `--calendar-hover` and `--calendar-on-accent` are no longer used.

For more control:

```css
church-calendar::part(event-title) { font-weight: 700; }
church-calendar::part(month-heading) { font-family: Georgia, serif; }
```

Available parts: `calendar`, `layout`, `navigation-column`, `navigation`, `month-select`, `day`, `list`, `month-heading`, `date-heading`, `event`, `event-title`, `event-time`, `event-location`, `event-registration`, `description`, `last-updated`.

At **640px or narrower**, measured against the component's own container, the picker is hidden and the last-updated timestamp appears below the event list, scrolling normally. Wider layouts keep the sticky picker and timestamp beside the list. Month changes affect only the picker; the list always retains all upcoming events from today onward. Selecting a day scrolls to the next listed event on or after it within the component’s scroll container, without moving the surrounding webpage. Give the component a fixed height and `overflow-y: auto` to enable internal scrolling; without an internal scroll container, date selection focuses the matching section without scrolling the page. Registration links open in new tabs. Descriptions are inline; there is no details dialog or Church Center link. An iframe remains possible.

The footnote directly below the picker shows **Last updated** in the configured calendar timezone. It uses `fetchedAt`, recorded after the complete upstream fetch and normalisation have succeeded; older snapshots fall back to `generatedAt`. It does not advance on a cache read, page load, or failed refresh. The picker and timestamp share a sticky column, so the timestamp stays below the picker while the event list scrolls. In the narrow layout, the picker is hidden and the timestamp appears below the list, scrolling normally. Style the timestamp with `church-calendar::part(last-updated)` or its shared column with `church-calendar::part(navigation-column)`.

### Event presentation

The day heading supplies the date. Single-day all-day events have no time subtitle. Timed events lasting one minute or less use `at` with the start time (for example, 6:00–6:01pm becomes `at 6pm`). Longer timed events use compact labels such as `at 6pm`, `6–7pm`, `9:30–11am`, or `11am–2pm`. Overnight events say `11pm–12am next day`; longer events use `6pm · until 24 Nov, 10am`, or only `until 24 Nov` for all-day events. Crossing into a new year includes the end year.

Genuine recurrence patterns share the subtitle, for example `10–11am · Every other Tuesday` or `11:30am–2pm · Second Sunday of each month`. The original recurrence start date and duplicate schedule prose/times are omitted. One-off API descriptions such as `Sunday, November 29, 2026 from start of day to end of day` are not treated as recurrence patterns.

A second row shows a location pin and the public location, a direct **Register** link, or both. Public descriptions appear as plain text below these details, preserving line breaks. Exact repetitions of the title or already displayed location/schedule are omitted. All titles are ordinary text with no icon or click action; there is no details dialog.

Only the first displayed occurrence of each Planning Center parent event shows its description. The grouping uses the parent `eventId`, never the event title. Changing the picker month does not change which occurrence has the description. When an earlier occurrence is no longer displayed, the next occurrence can show the description. Older cached snapshots without `eventId` keep their descriptions until a successful background refresh supplies the series identities.

## Publication and privacy rules

The authenticated API is not a public feed. The Worker explicitly requires:

- An ordinary `EventInstance` with its full associated `Event` available.
- `visible_in_church_center === true` and `link_only === false`.
- `approval_status === "A"` on the parent event (a conservative additional policy).
- `kind === "standard"`, `canceled === false`, and a defined all-day flag.
- A valid public schedule inside the configured date window.

Hidden, link-only, pending, rejected, cancelled, blockout, or restricted/stub resources are excluded. Missing publication fields fail closed. Public `EventTime` entries (`visible_on_widget_and_ical === true`) determine the public start/end envelope. If unavailable, explicit-offset ISO `published_starts_at`/`published_ends_at` may be used. Raw `starts_at`/`ends_at` are used for the upstream overlap query **only**, never for display. Multiple public schedule blocks are represented by their earliest start and latest end.

Only normalised presentation fields are stored in KV: occurrence and parent event IDs, title, public times, local dates, location, plain text public description, recurrence label, safe image/details/registration URLs, and tags. Rich text is converted to plain text and inserted with `textContent`; HTML is never executed. Links/images require HTTPS and cannot contain URL credentials. The internal owner, bookings, notes, and API response are never exposed or stored. A parent summary is the description fallback when the occurrence description is absent.

All-day schedule ends are treated as exclusive. Before launch, compare a real single-day and multi-day event against Church Center to confirm that assumption for your data. Also compare public/setup times and approval policies with your church's workflow. This integration has fixture tests; authenticating against your organisation is a separate launch check.

### Refresh and failure behaviour

A successful snapshot has no age-based expiry. Requests serve it immediately even if it is days old. When it is at least 15 minutes old, a visit starts a refresh in the background and retains that work with `ctx.waitUntil()`. Only a missing/malformed snapshot makes a visitor wait for upstream. If that initial fetch fails, the unavailable state is still necessary because no successful data exists yet.

A refresh follows every page (`per_page=100`), deduplicates instances, filters, and replaces the entire snapshot with one KV write. Its `generatedAt` records the fetch start and `fetchedAt` records the completed fetch and normalisation. Failed pages, validation/normalisation failures, and failed writes never intentionally replace or delete the last good snapshot. This includes authentication and permission errors (`401`/`403`). Newly hidden, cancelled, or deleted events disappear after a **successful** refresh, rather than immediately during an outage.

Page cycles, more than 200 pages, or a two-minute fetch budget abort the refresh. Planning Center `429` responses respect `Retry-After`; pagination uses returned rate-limit headers, and transient errors have bounded retries. Upstream fetches have timeouts and reject redirects/foreign pagination origins. Background failures are logged with diagnostic codes, stages and exception details; they do not turn a cached response into HTTP 503.

Concurrent requests within one Worker isolate share an in-flight refresh. Each isolate retains its latest successful snapshot so an older KV replica cannot replace it and a temporary KV read outage need not blank that instance. A failed refresh sets a 30-second retry backoff in that isolate. KV has no global lock: simultaneous visitors in different isolates can still cause duplicate read-only refreshes. For global deduplication at higher traffic, introduce a Durable Object coordinator.

API responses use `Cache-Control: no-store` so HTTP caches do not hide an updated KV snapshot. A visible embed checks the API every minute, or after 10 seconds when the response indicates a background refresh. It retains its displayed events, descriptions, and last-updated footnote if a request fails, and retries after 30 seconds. Hidden tabs stop checks and recheck on return without clearing their successful data. A successful response updates the display and footnote. The old `freshForMs` field and `/freshness.js` module are retained for cached older embeds during rollout; current components do not use a display expiry.

There is no cron or background schedule. No visitors (including open visible calendar tabs) means no Planning Center requests. The 15-minute threshold controls when a refresh is attempted, **not** the maximum age of displayed data. Check the footnote or `/health` when freshness matters. This availability policy intentionally replaces the earlier strict 15-minute cutoff.

CORS allows configured browser origins; it is **not authentication**. Anyone can retrieve this intentionally public snapshot through a non-browser client. Module scripts have wildcard CORS so they can load cross-origin. The standalone page restricts framing to configured origins. No arbitrary upstream proxy, token route, or public admin endpoint is exposed.

### Operations

- When no cache exists, the embed and `/api/events` show a short diagnostic code on failure. With a cache, failures are logged and the snapshot remains available. `PCO_CREDENTIALS_MISSING` means one or both runtime secrets are absent; `PCO_HTTP_401` means Planning Center rejected authentication; `PCO_HTTP_403` means Planning Center denied the request; `PCO_HTTP_400` means it rejected the API query. `PCO_FETCH_FAILED` indicates a transport/fetch failure, `PCO_RESPONSE_INVALID` an unexpected response, and `KV_READ_FAILED`/`KV_WRITE_FAILED` a storage failure. Public API codes never include credentials, raw exception text, or upstream response bodies. Private Worker console logs include structured exception details with credentials redacted.
- Check `/health` and Worker logs for refresh success, duration, page count, public event count, and skipped records. Logs do not contain event content or API secrets.

### Worker diagnostic logs

In the Cloudflare dashboard, open **Workers & Pages → planning-center-calendar → Observability → Logs** (or **Live logs**). Expand the request's console entries. All records are structured objects with `timestamp`, `action` and `phase`; all records from a refresh and its upstream requests share a `syncId`.

| Action | Recorded information |
| --- | --- |
| `cache` | KV key, whether KV contains a valid snapshot, in-memory availability, snapshot fetch time, read duration/errors, cold start, joining an existing refresh, retry backoff and next retry time |
| `sync` | Credential/binding presence (booleans only), API version, timezone/date window, current stage, input/output/skipped counts, KV payload bytes, completion time and total duration |
| `pco` | Validated endpoint, numeric pagination offset, page and attempt numbers, timeout/remaining budget, HTTP status, response content type/length, upstream request ID, rate-limit headers, retry delays and pagination totals |
| `request` | Unavailable responses or uncaught configuration/storage errors |

Failures include exception `name`, `message`, `stack`, optional `code` and nested causes. JSON syntax errors retain their name and stack frames but omit input-bearing messages. Text fields are limited to 8,000 characters. Known API credentials, encoded credentials, Basic/Bearer tokens and URL passwords are redacted. Logs never include request authorization headers, upstream response bodies or event records; pagination URLs are represented by their endpoint and numeric offset rather than arbitrary query values. These details are only in Worker logs; public error responses remain short diagnostic codes.

- Set up an availability alert if desired. Alerting is not provisioned by this repository.
- Refreshes follow actual calendar usage. Each refresh can make several API calls. Verify Cloudflare KV, Worker request, subrequest, and CPU limits against actual traffic and the chosen plan.
- There is no cron, alarm, or public admin refresh endpoint. Opening `/api/events` is the ordinary read-and-refresh path; `/health` never refreshes.
- Rotate/revoke PATs in Planning Center if exposed. Update both Worker secrets and verify the next refresh.
- For several churches, Planning Center requires OAuth rather than shared PATs. That needs separate tenant configuration, token storage/refresh, and snapshot isolation; generic names do not make this a multi-tenant service.

## Source references

- [Planning Center authentication](https://api.planningcenteronline.com/docs/overview/authentication)
- [API queries, includes, and pagination](https://api.planningcenteronline.com/docs/overview/json-api)
- [Event](https://api.planningcenteronline.com/docs/apps/calendar/versions/2026-06-22/vertices/event)
- [EventInstance](https://api.planningcenteronline.com/docs/apps/calendar/versions/2026-06-22/vertices/event_instance)
- [EventTime](https://api.planningcenteronline.com/docs/apps/calendar/versions/2026-06-22/vertices/event_time)
- [Rate limits](https://api.planningcenteronline.com/docs/overview/rate-limiting)
- [Cloudflare Worker static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Workers KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)

## Licence

[MIT](LICENSE). The repository licence applies to this application's source, not to Planning Center data, church branding, or third-party dependencies. This is an independent integration, not an official Planning Center product.
