# Planning Center Calendar for Cloudflare

A reusable, themeable event-list embed powered by Planning Center Calendar, Cloudflare Workers, and Workers KV. MIT licensed.

The calendar has a month navigator and a continuous list grouped by month and day. Event details open in an accessible native dialog over the host webpage. It uses a web component with Shadow DOM, with CSS custom properties and `::part()` hooks for custom styling. No frontend framework, visitor login, cookies, database, or client-side credentials are required.

## Architecture

```text
Visitors:
  Your website → embed.js → <church-calendar> → Worker /api/events → KV

If the snapshot is missing or approaching 15 minutes old:
  The request waits → Planning Center → publication filter → complete snapshot in KV
  The visitor receives the newly fetched snapshot (never the expired one)
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

`build` bundles a deployment with Wrangler's dry-run mode; it does not publish anything. Tests cover publication rules, public schedules, cancellations, restricted resources, pagination, auth failures, snapshot replacement, stale-data expiry, CORS, daylight saving, and all-day dates. CI runs these checks on pushes and pull requests.

Automated checks cover the request-driven refresh and strict 15-minute server/browser expiry, in addition to publication and API behaviour. The Wrangler deployment dry run is also checked. Browser QA is still pending because the development environment's preview relay timed out. Before launch, check desktop and mobile layouts, keyboard/focus behaviour in the details dialog, and a cross-origin embed on the actual website, then compare events against your real Planning Center account.

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
| `FALLBACK_URL` | Public Church Center calendar link shown if the API reports an outage |
| `PCO_USER_AGENT` | Identifies the application and supplies a contact URL/email |
| `PCO_API_VERSION` | Pinned to stable `2026-06-22`; the linked `2026-10-19` documentation was beta when this was written |
| Snapshot age | Hard limit of 15 minutes in code; expired data is never a fallback |
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

Open the calendar or `/api/events` to trigger the first refresh. A cold start waits for Planning Center before displaying results. Subsequent visitors reuse the snapshot until it approaches 15 minutes old; the first visitor after expiry waits for a complete replacement. If that refresh fails, the calendar shows an unavailable message rather than an old snapshot.

`/health` reports whether KV currently contains a fresh snapshot. It does **not** fetch events, so health monitoring does not create upstream traffic. Before the first real calendar visit, or after a quiet period exceeding 15 minutes, `/health` can legitimately return HTTP 503. An empty calendar (`events: []`) is a successful result if no public events match.

### Moving from the earlier cron version

Redeploy the latest `main` commit through **Workers & Pages → your Worker → Builds/Deployments**. The checked-in empty `triggers.crons` configuration removes the old schedule during deployment. If a trigger still appears under **Settings → Triggers → Cron Triggers**, delete it there. Keep the existing KV namespace and the two runtime secrets; no new Cloudflare service is required. Reload the embedding webpage to load the updated component.

For dashboard-only initial deployment, connect the repository in **Workers & Pages → Create application → GitHub**, name the Worker `planning-center-calendar`, leave the build command blank, and retain the default deploy command. Add `PCO_APPLICATION_ID` and `PCO_SECRET` as **Secret** values under the Worker's **Settings → Variables and Secrets**, not as build variables. Domains and the website embed are configured as described below.

### 5. Embed on your website

Paste this into a custom HTML/JavaScript block, changing the hostname as needed:

```html
<script type="module" src="https://calendar.stjohnsanglican.org.au/embed.js"></script>
<church-calendar></church-calendar>
```

See [examples/stjohns.html](examples/stjohns.html) for the branded configuration. If the website has a Content Security Policy, allow the calendar origin under `script-src` and `connect-src`, and the Planning Center image hosts under `img-src`. The component injects a stylesheet into its shadow root; the host CSP must allow that style (commonly through `style-src 'unsafe-inline'`). A stricter nonce-only host policy needs a corresponding stylesheet/nonce adaptation before use.

For a cross-origin local test, add the exact local host origin to `ALLOWED_ORIGINS` and use `api-url` if serving the component from another development origin. Plain HTTP is supported for local preview; production links and images require HTTPS.

## Customisation

```html
<church-calendar
  timezone="Australia/Sydney"
  style="
    --calendar-font-family: inherit;
    --calendar-text: #101729;
    --calendar-accent: #285f82;
    --calendar-background: #ffffff;
    --calendar-surface: #f4f6f9;
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
| `--calendar-muted` | `#545e6c` |
| `--calendar-accent` | `#285f82` (dark enough for normal text on white) |
| `--calendar-on-accent` | `#fff` |
| `--calendar-background` | `#fff` |
| `--calendar-surface` | `#f4f6f9` |
| `--calendar-border` | `#dce1e7` |
| `--calendar-hover` | `#e2eaf1` |
| `--calendar-border-radius` | `.375rem` |
| `--calendar-padding` | `1rem` |
| `--calendar-gap` | `3rem` |
| `--calendar-sticky-offset` | `1rem`; increase to clear a fixed website header |
| `--calendar-dialog-radius` | Falls back to the main border radius |
| `--calendar-dialog-padding` | `1.75rem` |
| `--calendar-backdrop` | `rgba(12,20,35,.65)` |

For more control:

```css
church-calendar::part(event-title) { font-weight: 700; }
church-calendar::part(month-heading) { font-family: Georgia, serif; }
church-calendar::part(dialog) { max-width: 48rem; }
```

Available parts: `calendar`, `layout`, `navigation`, `month-select`, `day`, `list`, `month-heading`, `date-heading`, `event`, `event-title`, `event-time`, `dialog`, `dialog-content`, `dialog-title`, `dialog-image`, `description`, `close-button`, `registration-link`.

The navigation stacks above the list when the **component's container** is narrow, even on a wide desktop. Month changes show that month and all later events in the window. Selecting a day jumps to the next listed event on or after it. The details dialog uses the host webpage's top layer, supports Escape/backdrop/Close, and restores focus. Registration and Church Center links open in new tabs. An iframe remains possible, but any dialog inside it is confined to the iframe viewport.

## Publication and privacy rules

The authenticated API is not a public feed. The Worker explicitly requires:

- An ordinary `EventInstance` with its full associated `Event` available.
- `visible_in_church_center === true` and `link_only === false`.
- `approval_status === "A"` on the parent event (a conservative additional policy).
- `kind === "standard"`, `canceled === false`, and a defined all-day flag.
- A valid public schedule inside the configured date window.

Hidden, link-only, pending, rejected, cancelled, blockout, or restricted/stub resources are excluded. Missing publication fields fail closed. Public `EventTime` entries (`visible_on_widget_and_ical === true`) determine the public start/end envelope. If unavailable, explicit-offset ISO `published_starts_at`/`published_ends_at` may be used. Raw `starts_at`/`ends_at` are used for the upstream overlap query **only**, never for display. Multiple public schedule blocks are represented by their earliest start and latest end.

Only normalised presentation fields are stored in KV: title, public times, local dates, location, plain text public description, recurrence label, safe image/details/registration URLs, and tags. Rich text is converted to plain text and inserted with `textContent`; HTML is never executed. Links/images require HTTPS and cannot contain URL credentials. The internal owner, bookings, notes, and API response are never exposed or stored. A parent summary is the description fallback when the occurrence description is absent.

All-day schedule ends are treated as exclusive. Before launch, compare a real single-day and multi-day event against Church Center to confirm that assumption for your data. Also compare public/setup times and approval policies with your church's workflow. This integration has fixture tests; authenticating against your organisation is a separate launch check.

### Refresh and failure behaviour

Each request first checks the original timestamp of the stored snapshot. Data older than 15 minutes, future-dated data, and invalid timestamps are never served. Missing/expired snapshots trigger a blocking refresh; there is no stale-while-revalidate path and no 45-minute fallback. A refresh can start up to one second early to leave time for delivery to the browser. The timestamp is taken at the **start** of the upstream fetch so time spent collecting pages counts toward the age limit.

A refresh follows every page (`per_page=100`), deduplicates instances, filters, and replaces the entire snapshot with one KV write. This removes deleted/newly hidden/cancelled events without keeping tombstones. A failed page never publishes a partial snapshot. Page cycles, more than 200 pages, or a two-minute sync budget abort the refresh; larger organisations should use a partitioned sync architecture rather than silently truncating data.

Planning Center `429` responses respect `Retry-After`. Pagination pacing uses the returned rate-limit headers, and transient server errors have bounded retries. Upstream fetches have timeouts and refuse redirects/foreign pagination origins, preventing credential forwarding. A detected `401`/`403` deletes the stored snapshot. Other failed refreshes can leave the previous snapshot in storage, but it is never returned after its 15-minute deadline.

Concurrent requests within one Worker isolate share an in-flight refresh. KV has no global lock: simultaneous visitors in different isolates or KV propagation delays can cause duplicate read-only refreshes. That is an intentional simplicity tradeoff for a low-traffic calendar, not a globally enforced API-call interval. Timestamp checks still prevent expired responses; a refresh returns its freshly fetched result directly instead of re-reading a possibly old KV replica. For global request deduplication at higher traffic, introduce a Durable Object coordinator.

API responses use `Cache-Control: no-store`, and the embed bypasses its HTTP cache. Each response includes the snapshot's remaining lifetime. The browser subtracts the full request duration plus a small margin, then clears the list and closes its details dialog at expiry before requesting a replacement. Both monotonic and wall-clock deadlines are checked; expiry is also checked before interactions. Hidden/page-cached views discard their displayed snapshot and recheck on return. Normal browser timers/event handlers enforce this while the page is running; no JavaScript can update a frozen or suspended browser until it resumes.

There is no background schedule. No visitors (including open visible calendar tabs) means no Planning Center requests. A visible tab fetches again when its displayed snapshot expires so it continues to show fresh data. On failure it shows an unavailable state and retries after 30 seconds while visible; this does not extend a snapshot's lifetime. The 15-minute promise refers to age since the fetch started, not to Planning Center's own internal propagation delay or an atomic point-in-time view across API pages.

CORS allows configured browser origins; it is **not authentication**. Anyone can retrieve this intentionally public snapshot through a non-browser client. Module scripts have wildcard CORS so they can load cross-origin. The standalone page restricts framing to configured origins. No arbitrary upstream proxy, token route, or public admin endpoint is exposed.

### Operations

- Check `/health` and Worker logs for refresh success, duration, page count, public event count, and skipped records. Logs do not contain event content or API secrets.
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
