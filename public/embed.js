import { deadlinePassed, displayLifetime } from './freshness.js';
import { eventDates, keyForDate, labelDate, monthDays, monthShift, timeLabel } from './dates.js';

const DEFAULT_API = new URL('/api/events', import.meta.url).href;
const STYLE = `
  :host { display:block; container-type:inline-size; color:var(--calendar-text,#101729); font-family:var(--calendar-font-family,inherit); font-size:var(--calendar-font-size,1rem); line-height:1.6; color-scheme:light; }
  *, *::before, *::after { box-sizing:border-box; }
  button, select { font:inherit; color:inherit; }
  button { cursor:pointer; }
  button:disabled { cursor:default; opacity:.35; }
  button:focus-visible, a:focus-visible, select:focus-visible, [tabindex]:focus-visible { outline:3px solid var(--calendar-accent,#285f82); outline-offset:4px; }
  a { color:var(--calendar-accent,#285f82); text-underline-offset:.2em; }
  .layout { display:grid; grid-template-columns:17rem minmax(0,1fr); gap:var(--calendar-gap,3rem); align-items:start; background:var(--calendar-background,#fff); padding:var(--calendar-padding,1rem); }
  .navigation { position:sticky; top:var(--calendar-sticky-offset,1rem); padding:1rem; border:1px solid var(--calendar-border,#dce1e7); border-radius:var(--calendar-border-radius,.375rem); background:var(--calendar-surface,#f4f6f9); }
  .month-controls { display:flex; justify-content:space-between; align-items:center; gap:.25rem; margin-bottom:.75rem; }
  .month-controls button { border:0; background:transparent; min-width:2.75rem; min-height:2.75rem; border-radius:var(--calendar-border-radius,.375rem); }
  .month-controls svg { width:1.25rem; height:1.25rem; vertical-align:middle; }
  select { font-size:.95rem; font-weight:650; width:100%; max-width:12rem; background:transparent; border:0; padding:.5rem .25rem; }
  .weekdays, .days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); text-align:center; }
  .weekdays span { font-size:.875rem; font-weight:600; padding:.5rem 0; color:var(--calendar-muted,#545e6c); }
  .days button { min-height:2.75rem; min-width:0; border:0; border-radius:var(--calendar-border-radius,.375rem); background:transparent; position:relative; padding:.3rem 0 .6rem; font-size:.875rem; }
  .days button:not(:disabled):hover, .month-controls button:not(:disabled):hover { background:var(--calendar-hover,#e2eaf1); }
  .days .today { font-weight:750; box-shadow:inset 0 0 0 1px var(--calendar-accent,#285f82); }
  .days .selected { background:var(--calendar-accent,#285f82); color:var(--calendar-on-accent,#fff); }
  .days .selected:not(:disabled):hover { background:var(--calendar-accent,#285f82); }
  .dot { position:absolute; bottom:.25rem; left:calc(50% - .125rem); width:.25rem; height:.25rem; border-radius:50%; background:currentColor; }
  .today-button { width:100%; margin-top:.75rem; background:transparent; border:1px solid var(--calendar-border,#dce1e7); border-radius:var(--calendar-border-radius,.375rem); min-height:2.75rem; }
  .list { min-width:0; }
  .month-section { margin-bottom:2.5rem; scroll-margin-top:var(--calendar-sticky-offset,1rem); }
  h2 { font-size:1.375rem; margin:0 0 1.5rem; font-weight:700; }
  h3 { font-size:.875rem; text-transform:uppercase; letter-spacing:.045em; font-weight:650; color:var(--calendar-muted,#545e6c); margin:0 0 .5rem; }
  .day-section { margin-bottom:1.5rem; scroll-margin-top:var(--calendar-sticky-offset,1rem); }
  .event { padding:.75rem 0; border-bottom:1px solid var(--calendar-border,#dce1e7); }
  .event-button { display:block; border:0; background:transparent; color:var(--calendar-accent,#285f82); text-align:left; padding:0; min-height:2.75rem; font-size:1.125rem; font-weight:650; line-height:1.45; }
  .event-button:hover { text-decoration:underline; text-underline-offset:.2em; }
  .metadata { color:var(--calendar-muted,#545e6c); font-size:.9375rem; }
  .recurrence { font-size:.875rem; }
  .status { padding:1.5rem; background:var(--calendar-surface,#f4f6f9); border-radius:var(--calendar-border-radius,.375rem); }
  .status p { margin:0 0 .75rem; }
  .retry { padding:.5rem 1rem; border:1px solid var(--calendar-border,#dce1e7); background:var(--calendar-background,#fff); border-radius:var(--calendar-border-radius,.375rem); }
  .notice { padding:.75rem 1rem; margin-bottom:1rem; background:var(--calendar-surface,#f4f6f9); font-size:.9375rem; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  dialog { color:var(--calendar-text,#101729); background:var(--calendar-background,#fff); font:inherit; border:1px solid var(--calendar-border,#dce1e7); border-radius:var(--calendar-dialog-radius,var(--calendar-border-radius,.375rem)); padding:0; width:min(42rem,calc(100vw - 2rem)); max-height:85vh; max-height:85dvh; box-shadow:0 1.5rem 5rem #0004; }
  dialog::backdrop { background:var(--calendar-backdrop,rgba(12,20,35,.65)); }
  .dialog-content { padding:var(--calendar-dialog-padding,1.75rem); }
  .dialog-top { display:flex; gap:1rem; align-items:start; justify-content:space-between; margin-bottom:1rem; }
  .dialog-top h2 { margin:0; font-size:1.5rem; line-height:1.3; }
  .close { flex-shrink:0; border:1px solid var(--calendar-border,#dce1e7); background:transparent; border-radius:var(--calendar-border-radius,.375rem); min-height:2.75rem; padding:.4rem .75rem; }
  .image { display:block; width:100%; max-height:22rem; object-fit:contain; background:var(--calendar-surface,#f4f6f9); }
  .description { white-space:pre-wrap; overflow-wrap:anywhere; margin:1.5rem 0; }
  .actions { display:flex; flex-wrap:wrap; gap:1rem; margin-top:1.5rem; align-items:center; }
  .register { background:var(--calendar-accent,#285f82); color:var(--calendar-on-accent,#fff); padding:.65rem 1.25rem; border-radius:var(--calendar-border-radius,.375rem); text-decoration:none; font-weight:650; }
  .location { white-space:pre-wrap; }
  @container (max-width: 640px) { .layout { grid-template-columns:minmax(0,1fr); gap:1.75rem; } .navigation { position:static; width:100%; max-width:25rem; margin:0 auto; } }
  @media (max-width: 480px) { dialog { width:calc(100vw - 1rem); max-height:94dvh; } .dialog-content { padding:1.25rem; } }
  @media (prefers-reduced-motion:no-preference) { .event-button { transition:color .15s; } }
`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function externalLink(text, url, className) {
  const link = element('a', className, text);
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${text} (opens in a new tab)`);
  return link;
}

export class ChurchCalendar extends HTMLElement {
  static observedAttributes = ['timezone', 'api-url'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const style = element('style'); style.textContent = STYLE;
    this.main = element('div'); this.main.setAttribute('part', 'calendar');
    this.dialog = element('dialog'); this.dialog.setAttribute('part', 'dialog');
    this.dialog.setAttribute('aria-labelledby', 'event-title');
    this.shadowRoot.append(style, this.main, this.dialog);
    this.main.addEventListener('click', (event) => this.onClick(event));
    this.main.addEventListener('change', (event) => {
      if (event.target.matches('[data-month-select]')) {
        if (!this.hasFreshSnapshot()) { this.clearSnapshot(); this.load(); return; }
        this.selectMonth(event.target.value, 'select');
      }
    });
    this.dialog.addEventListener('click', (event) => {
      if (!this.hasFreshSnapshot()) {
        event.preventDefault(); this.clearSnapshot(); this.load(); return;
      }
      if (event.target.closest('[data-close]')) this.dialog.close();
      else if (event.target === this.dialog) {
        const r = this.dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.dialog.close();
      }
    });
    this.dialog.addEventListener('close', () => this.lastTrigger?.focus({ preventScroll: true }));
    this.onVisibility = () => {
      if (document.hidden) { this.controller?.abort(); this.clearSnapshot(); clearTimeout(this.retryTimer); }
      else this.load(true);
    };
    this.onPageHide = () => { this.controller?.abort(); this.clearSnapshot(); clearTimeout(this.retryTimer); };
    this.onPageShow = (event) => { if (event.persisted && !document.hidden) this.load(true); };
  }

  connectedCallback() {
    this.load();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
  }

  disconnectedCallback() {
    clearTimeout(this.expiryTimer);
    clearTimeout(this.retryTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    this.controller?.abort();
    if (this.dialog.open) this.dialog.close();
  }

  attributeChangedCallback() {
    if (this.isConnected) { this.selectedMonth = null; this.clearSnapshot(); this.load(true); }
  }

  hasFreshSnapshot() {
    return this.snapshot && !deadlinePassed(this.deadline, performance.now(), Date.now());
  }

  clearSnapshot() {
    clearTimeout(this.expiryTimer);
    this.deadline = null;
    this.snapshot = null;
    if (this.dialog.open) this.dialog.close();
    this.showStatus('Loading events…');
  }

  async load(force = false) {
    if (this.loading && !force) return;
    this.loading = true;
    clearTimeout(this.retryTimer);
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    if (!this.hasFreshSnapshot()) this.clearSnapshot();
    const started = performance.now(), wallStarted = Date.now();
    try {
      const endpoint = new URL(this.getAttribute('api-url') || DEFAULT_API, document.baseURI);
      if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Invalid API URL');
      const response = await fetch(endpoint, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      const data = await response.json();
      if (controller.signal.aborted || !this.isConnected || document.hidden) return;
      this.fallbackUrl = httpsUrl(data.fallbackUrl);
      if (!response.ok || data.schemaVersion !== 1 || !Array.isArray(data.events)) throw new Error('Events unavailable');
      const lifetime = displayLifetime(data.freshForMs, Math.max(performance.now() - started, Date.now() - wallStarted));
      if (lifetime <= 0) throw new Error('Snapshot expired in transit');
      clearTimeout(this.expiryTimer);
      this.deadline = { monotonic: performance.now() + lifetime, wall: Date.now() + lifetime };
      this.expiryTimer = setTimeout(() => {
        this.clearSnapshot();
        if (!document.hidden) this.load();
      }, lifetime);
      this.timezone = this.getAttribute('timezone') || data.timezone;
      new Intl.DateTimeFormat('en', { timeZone: this.timezone }).format();
      this.today = keyForDate(new Date(), this.timezone);
      this.minMonth = this.today.slice(0, 7);
      this.maxMonth = keyForDate(new Date(Date.parse(data.window.to) - 1), this.timezone).slice(0, 7);
      this.selectedMonth = this.selectedMonth && this.selectedMonth >= this.minMonth && this.selectedMonth <= this.maxMonth ? this.selectedMonth : this.minMonth;
      // An open dialog is refreshed or closed when its event disappears.
      const changed = this.snapshot?.generatedAt !== data.generatedAt;
      this.snapshot = data;
      if (changed || !this.main.querySelector('.layout')) {
        this.render();
        if (this.dialog.open) {
          const current = data.events.find((event) => event.id === this.openId);
          if (current) this.fillDialog(current); else this.dialog.close();
        }
      }
      if (!this.hasFreshSnapshot()) throw new Error('Snapshot expired while rendering');
    } catch (error) {
      if (controller.signal.aborted || !this.isConnected) return;
      this.clearSnapshot();
      this.showStatus('The calendar is temporarily unavailable. Please try again shortly.', true);
      this.retryTimer = setTimeout(() => { if (!document.hidden) this.load(); }, 30_000);
    } finally {
      if (this.controller === controller) this.loading = false;
    }
  }

  showStatus(message, retry = false) {
    const box = element('div', 'status'); box.setAttribute('role', 'status');
    box.append(element('p', '', message));
    if (retry) {
      const button = element('button', 'retry', 'Try again'); button.dataset.retry = ''; box.append(button);
      if (this.fallbackUrl) box.append(document.createTextNode(' '), externalLink('View calendar on Church Center', this.fallbackUrl));
    }
    this.main.replaceChildren(box);
  }

  monthEvents() {
    return this.snapshot.events.filter((event) => Date.parse(event.end) >= Date.now() && eventDates(event, this.timezone).end >= `${this.selectedMonth}-01`);
  }

  render() {
    // Preserve keyboard focus across background refreshes and navigation rerenders.
    const active = this.shadowRoot.activeElement;
    const focusedAction = active?.dataset?.action;
    const focusedDay = active?.dataset?.day;
    const focusedEvent = active?.dataset?.event;
    const focusedSelect = active?.hasAttribute('data-month-select');
    const layout = element('div', 'layout'); layout.setAttribute('part', 'layout');
    layout.append(this.renderNavigation(), this.renderList());
    const nodes = [];
    if (this.snapshot.demo) {
      const notice = element('div', 'notice', 'Sample calendar — these are demonstration events.');
      notice.setAttribute('role', 'status'); nodes.push(notice);
    }
    nodes.push(layout); this.main.replaceChildren(...nodes);
    if (this.dialog.open) this.lastTrigger = [...this.main.querySelectorAll('[data-event]')].find((n) => n.dataset.event === this.openId);
    if (focusedAction) [...this.main.querySelectorAll('[data-action]')].find((n) => n.dataset.action === focusedAction)?.focus({ preventScroll: true });
    if (focusedDay) [...this.main.querySelectorAll('[data-day]')].find((n) => n.dataset.day === focusedDay)?.focus({ preventScroll: true });
    if (focusedEvent) [...this.main.querySelectorAll('[data-event]')].find((n) => n.dataset.event === focusedEvent)?.focus({ preventScroll: true });
    if (focusedSelect) this.main.querySelector('select')?.focus({ preventScroll: true });
  }

  renderNavigation() {
    const nav = element('nav', 'navigation'); nav.setAttribute('aria-label', 'Calendar date navigation'); nav.setAttribute('part', 'navigation');
    const controls = element('div', 'month-controls');
    for (const [action, label, path] of [['prev', 'Previous month', 'm14 6-6 6 6 6'], ['next', 'Next month', 'm10 6 6 6-6 6']]) {
      const button = element('button'); button.dataset.action = action; button.setAttribute('aria-label', label);
      button.disabled = action === 'prev' ? this.selectedMonth <= this.minMonth : this.selectedMonth >= this.maxMonth;
      // Only static, application-owned SVG is parsed as markup.
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
      controls.append(button);
    }
    const select = element('select'); select.dataset.monthSelect = ''; select.setAttribute('aria-label', 'Choose month'); select.setAttribute('part', 'month-select');
    for (let key = this.minMonth; key <= this.maxMonth; key = monthShift(key, 1)) {
      const option = element('option', '', labelDate(`${key}-01`, { month: 'long', year: 'numeric' }));
      option.value = key; option.selected = key === this.selectedMonth; select.append(option);
    }
    controls.insertBefore(select, controls.lastChild); nav.append(controls);
    const weekdays = element('div', 'weekdays'); weekdays.setAttribute('aria-hidden', 'true');
    for (const day of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) weekdays.append(element('span', '', day));
    nav.append(weekdays);
    const days = element('div', 'days');
    const counts = new Map();
    for (const event of this.monthEvents()) {
      const key = eventDates(event, this.timezone).start;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const day of monthDays(this.selectedMonth)) {
      const classes = [day.key === this.today ? 'today' : '', day.key === this.selectedDay ? 'selected' : ''].join(' ');
      const button = element('button', classes, String(day.day)); button.dataset.day = day.key; button.setAttribute('part', 'day');
      button.disabled = !day.inMonth || day.key < this.today || day.key > keyForDate(new Date(Date.parse(this.snapshot.window.to) - 1), this.timezone);
      const count = counts.get(day.key) || 0;
      button.setAttribute('aria-label', `${labelDate(day.key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${count ? `, ${count} event${count === 1 ? '' : 's'}` : ''}`);
      if (day.key === this.today) button.setAttribute('aria-current', 'date');
      if (day.key === this.selectedDay) button.setAttribute('aria-pressed', 'true');
      if (count) { const dot = element('span', 'dot'); dot.setAttribute('aria-hidden', 'true'); button.append(dot); }
      days.append(button);
    }
    const today = element('button', 'today-button', 'Today'); today.dataset.action = 'today';
    nav.append(days, today);
    return nav;
  }

  renderList() {
    const list = element('div', 'list'); list.setAttribute('part', 'list');
    const events = this.monthEvents();
    const announcement = element('div', 'sr-only', `${labelDate(`${this.selectedMonth}-01`, { month: 'long', year: 'numeric' })}. ${events.length} upcoming events from this month.`);
    announcement.setAttribute('role', 'status'); list.append(announcement);
    let month, day, monthSection, daySection;
    for (const event of events) {
      const dates = eventDates(event, this.timezone);
      // An event spanning into this month is included under this month's first date.
      const groupDay = dates.start < `${this.selectedMonth}-01` ? `${this.selectedMonth}-01` : dates.start;
      if (groupDay.slice(0, 7) !== month) {
        month = groupDay.slice(0, 7); monthSection = element('section', 'month-section'); monthSection.dataset.month = month;
        const heading = element('h2', '', labelDate(`${month}-01`, { month: 'long', year: 'numeric' })); heading.setAttribute('part', 'month-heading');
        monthSection.append(heading); list.append(monthSection);
      }
      if (groupDay !== day) {
        day = groupDay; daySection = element('section', 'day-section'); daySection.dataset.date = day; daySection.tabIndex = -1;
        const heading = element('h3', '', labelDate(day, { weekday: 'long', day: 'numeric', month: 'short' })); heading.setAttribute('part', 'date-heading');
        daySection.append(heading); monthSection.append(daySection);
      }
      const row = element('article', 'event'); row.setAttribute('part', 'event');
      const button = element('button', 'event-button', event.title); button.dataset.event = event.id; button.setAttribute('part', 'event-title');
      button.setAttribute('aria-haspopup', 'dialog');
      const time = element('div', 'metadata', timeLabel(event, this.timezone)); time.setAttribute('part', 'event-time');
      row.append(button, time);
      if (event.recurrence) row.append(element('div', 'metadata recurrence', event.recurrence));
      daySection.append(row);
    }
    if (!events.length) list.append(element('h2', '', labelDate(`${this.selectedMonth}-01`, { month: 'long', year: 'numeric' })), element('p', '', 'No upcoming events in this period.'));
    return list;
  }

  selectMonth(key, focusAction) {
    if (key < this.minMonth || key > this.maxMonth) return;
    this.selectedMonth = key; this.selectedDay = null; this.render();
    if (focusAction === 'select') this.main.querySelector('select')?.focus({ preventScroll: true });
  }

  onClick(event) {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.hasAttribute('data-retry')) { this.load(); return; }
    if (!this.hasFreshSnapshot()) { this.clearSnapshot(); this.load(); return; }
    if (target.dataset.event) {
      const data = this.snapshot.events.find((item) => item.id === target.dataset.event);
      if (data) { this.lastTrigger = target; this.openId = data.id; this.fillDialog(data); this.dialog.showModal(); }
    }
    if (target.dataset.action === 'next') this.selectMonth(monthShift(this.selectedMonth, 1));
    if (target.dataset.action === 'prev') this.selectMonth(monthShift(this.selectedMonth, -1));
    if (target.dataset.action === 'today') this.selectMonth(this.minMonth);
    if (target.dataset.day) {
      this.selectedDay = target.dataset.day; this.render();
      const section = [...this.main.querySelectorAll('[data-date]')].find((node) => node.dataset.date >= this.selectedDay);
      if (section) { section.scrollIntoView({ block: 'start', behavior: 'instant' }); section.focus({ preventScroll: true }); }
    }
  }

  fillDialog(event) {
    const focusedClose = this.shadowRoot.activeElement?.hasAttribute('data-close');
    const nodes = [];
    const imageUrl = httpsUrl(event.imageUrl);
    if (imageUrl) {
      const image = element('img', 'image'); image.src = imageUrl; image.alt = ''; image.referrerPolicy = 'no-referrer'; image.setAttribute('part', 'dialog-image'); nodes.push(image);
    }
    const content = element('div', 'dialog-content'); content.setAttribute('part', 'dialog-content');
    const top = element('div', 'dialog-top');
    const title = element('h2', '', event.title); title.id = 'event-title'; title.setAttribute('part', 'dialog-title');
    const close = element('button', 'close', 'Close'); close.dataset.close = ''; close.autofocus = true; close.setAttribute('part', 'close-button');
    top.append(title, close); content.append(top);
    const { start } = eventDates(event, this.timezone);
    content.append(element('p', '', `${labelDate(start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${timeLabel(event, this.timezone)}`));
    if (!event.allDay) content.append(element('p', 'metadata', `Times shown in ${this.timezone.replaceAll('_', ' ')}`));
    if (event.location) content.append(element('p', 'location', event.location));
    if (event.description) { const description = element('div', 'description', event.description); description.setAttribute('part', 'description'); content.append(description); }
    const actions = element('div', 'actions');
    const registration = httpsUrl(event.registrationUrl), details = httpsUrl(event.detailsUrl);
    if (registration) { const link = externalLink('Register', registration, 'register'); link.setAttribute('part', 'registration-link'); actions.append(link); }
    if (details) actions.append(externalLink('View on Church Center', details));
    content.append(actions); nodes.push(content); this.dialog.replaceChildren(...nodes);
    if (focusedClose) close.focus({ preventScroll: true });
  }
}

if (!customElements.get('church-calendar')) customElements.define('church-calendar', ChurchCalendar);
