import { eventDates, keyForDate, labelDate, monthDays, monthShift } from './dates.js';
import { additionalDescription, eventSubtitle } from './presentation.js';

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
  .navigation { position:sticky; top:var(--calendar-sticky-offset,1rem); padding:1rem; border:1px solid var(--calendar-border,color-mix(in srgb,var(--calendar-text,#101729) 15%,var(--calendar-background,#fff))); border-radius:var(--calendar-border-radius,.375rem); background:var(--calendar-surface,color-mix(in srgb,var(--calendar-text,#101729) 4%,var(--calendar-background,#fff))); }
  .navigation button, .navigation select { -webkit-tap-highlight-color:transparent; }
  .navigation button:focus:not(:focus-visible), .navigation select:focus:not(:focus-visible) { outline:none; }
  .month-controls { display:flex; justify-content:space-between; align-items:center; gap:.25rem; margin-bottom:.75rem; }
  .month-controls button { border:0; background:transparent; min-width:2.75rem; min-height:2.75rem; border-radius:var(--calendar-border-radius,.375rem); }
  .month-controls svg { width:1.25rem; height:1.25rem; vertical-align:middle; }
  select { font-size:.95rem; font-weight:650; width:100%; max-width:12rem; background:transparent; border:0; padding:.5rem .25rem; }
  .weekdays, .days { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); text-align:center; }
  .weekdays span { font-size:.875rem; font-weight:600; padding:.5rem 0; color:var(--calendar-muted,color-mix(in srgb,var(--calendar-text,#101729) 70%,var(--calendar-background,#fff))); }
  .days button { min-height:2.75rem; min-width:0; border:0; border-radius:var(--calendar-border-radius,.375rem); background:transparent; position:relative; padding:.3rem 0 .6rem; font-size:.875rem; }
  .days .today { font-weight:750; }
  .dot { position:absolute; bottom:.25rem; left:calc(50% - .125rem); width:.25rem; height:.25rem; border-radius:50%; background:currentColor; }
  .today-button { width:100%; margin-top:.75rem; background:transparent; border:1px solid var(--calendar-border,color-mix(in srgb,var(--calendar-text,#101729) 15%,var(--calendar-background,#fff))); border-radius:var(--calendar-border-radius,.375rem); min-height:2.75rem; }
  .list { min-width:0; }
  .month-section { margin-bottom:2.5rem; scroll-margin-top:var(--calendar-sticky-offset,1rem); }
  h2 { font-size:1.375rem; margin:0 0 1.5rem; font-weight:700; }
  h3 { font-size:.875rem; text-transform:uppercase; letter-spacing:.045em; font-weight:650; color:var(--calendar-muted,color-mix(in srgb,var(--calendar-text,#101729) 70%,var(--calendar-background,#fff))); margin:0 0 .5rem; }
  .day-section { margin-bottom:1.5rem; scroll-margin-top:var(--calendar-sticky-offset,1rem); }
  .event { padding:.75rem 0; border-bottom:1px solid var(--calendar-border,color-mix(in srgb,var(--calendar-text,#101729) 15%,var(--calendar-background,#fff))); }
  .event-title { margin:0; font-size:1.125rem; font-weight:650; line-height:1.45; }
  .metadata { color:var(--calendar-muted,color-mix(in srgb,var(--calendar-text,#101729) 70%,var(--calendar-background,#fff))); font-size:.9375rem; }
  .event-links { margin-top:.25rem; font-size:.9375rem; color:var(--calendar-muted,color-mix(in srgb,var(--calendar-text,#101729) 70%,var(--calendar-background,#fff))); }
  .status { padding:1.5rem; background:var(--calendar-surface,color-mix(in srgb,var(--calendar-text,#101729) 4%,var(--calendar-background,#fff))); border-radius:var(--calendar-border-radius,.375rem); }
  .status p { margin:0 0 .75rem; }
  .retry { padding:.5rem 1rem; border:1px solid var(--calendar-border,color-mix(in srgb,var(--calendar-text,#101729) 15%,var(--calendar-background,#fff))); background:var(--calendar-background,#fff); border-radius:var(--calendar-border-radius,.375rem); }
  .last-updated { margin:.75rem 0 0; padding:0 var(--calendar-padding,1rem); color:var(--calendar-muted,color-mix(in srgb,var(--calendar-text,#101729) 70%,var(--calendar-background,#fff))); font-size:.875rem; }
  .notice { padding:.75rem 1rem; margin-bottom:1rem; background:var(--calendar-surface,color-mix(in srgb,var(--calendar-text,#101729) 4%,var(--calendar-background,#fff))); font-size:.9375rem; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .description { white-space:pre-wrap; overflow-wrap:anywhere; margin:.5rem 0 0; }
  @container (max-width: 640px) { .layout { grid-template-columns:minmax(0,1fr); gap:1.75rem; } .navigation { position:static; width:100%; max-width:25rem; margin:0 auto; } }
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
    this.shadowRoot.append(style, this.main);
    this.main.addEventListener('click', (event) => this.onClick(event));
    this.main.addEventListener('change', (event) => {
      if (event.target.matches('[data-month-select]')) {
        if (!this.hasSnapshot()) { this.clearSnapshot(); this.load(); return; }
        this.selectMonth(event.target.value, 'select');
      }
    });
    this.onVisibility = () => {
      if (document.hidden) { this.controller?.abort(); clearTimeout(this.refreshTimer); clearTimeout(this.retryTimer); }
      else this.load(true);
    };
    this.onPageHide = () => { this.controller?.abort(); clearTimeout(this.refreshTimer); clearTimeout(this.retryTimer); };
    this.onPageShow = (event) => { if (event.persisted && !document.hidden) this.load(true); };
  }

  connectedCallback() {
    this.load();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
  }

  disconnectedCallback() {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.retryTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    this.controller?.abort();
  }

  attributeChangedCallback() {
    if (this.isConnected) { this.selectedMonth = null; this.clearSnapshot(); this.load(true); }
  }

  hasSnapshot() {
    return !!this.snapshot;
  }

  clearSnapshot() {
    clearTimeout(this.refreshTimer);
    this.snapshot = null;
    this.showStatus('Loading events…');
  }

  async load(force = false) {
    if (this.loading && !force) return;
    this.loading = true;
    clearTimeout(this.retryTimer);
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    if (!this.hasSnapshot()) this.clearSnapshot();
    let failureCode;
    try {
      const endpoint = new URL(this.getAttribute('api-url') || DEFAULT_API, document.baseURI);
      if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Invalid API URL');
      const response = await fetch(endpoint, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      const data = await response.json();
      if (controller.signal.aborted || !this.isConnected || document.hidden) return;
      this.fallbackUrl = httpsUrl(data.fallbackUrl);
      if (typeof data.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(data.code)) failureCode = data.code;
      if (!response.ok || data.schemaVersion !== 1 || !Array.isArray(data.events)) throw new Error('Events unavailable');
      if (!Number.isFinite(Date.parse(data.fetchedAt || data.generatedAt))) throw new Error('Invalid snapshot timestamp');
      clearTimeout(this.refreshTimer);
      const refreshAfterMs = Number.isFinite(data.refreshAfterMs) ? Math.max(5000, Math.min(60_000, data.refreshAfterMs)) : 60_000;
      this.refreshTimer = setTimeout(() => { if (!document.hidden) this.load(); }, refreshAfterMs);
      this.timezone = this.getAttribute('timezone') || data.timezone;
      new Intl.DateTimeFormat('en', { timeZone: this.timezone }).format();
      this.today = keyForDate(new Date(), this.timezone);
      this.minMonth = this.today.slice(0, 7);
      this.maxMonth = keyForDate(new Date(Date.parse(data.window.to) - 1), this.timezone).slice(0, 7);
      this.selectedMonth = this.selectedMonth && this.selectedMonth >= this.minMonth && this.selectedMonth <= this.maxMonth ? this.selectedMonth : this.minMonth;
      const changed = this.snapshot?.generatedAt !== data.generatedAt || this.snapshot?.fetchedAt !== data.fetchedAt;
      this.snapshot = data;
      if (changed || !this.main.querySelector('.layout')) {
        this.render();
      }
    } catch (error) {
      if (controller.signal.aborted || !this.isConnected) return;
      // A failed recheck must not erase a previously displayed good snapshot.
      if (!this.hasSnapshot()) this.showStatus(`The calendar is temporarily unavailable. Please try again shortly.${failureCode ? ` (${failureCode})` : ''}`, true);
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
    }
    this.main.replaceChildren(box);
  }

  upcomingEvents() {
    return this.snapshot.events.filter((event) => Date.parse(event.end) >= Date.now());
  }

  render() {
    // Preserve keyboard focus across background refreshes and navigation rerenders.
    const active = this.shadowRoot.activeElement;
    const focusedAction = active?.dataset?.action;
    const focusedDay = active?.dataset?.day;
    const focusedSelect = active?.hasAttribute('data-month-select');
    const layout = element('div', 'layout'); layout.setAttribute('part', 'layout');
    layout.append(this.renderNavigation(), this.renderList());
    const nodes = [];
    if (this.snapshot.demo) {
      const notice = element('div', 'notice', 'Sample calendar — these are demonstration events.');
      notice.setAttribute('role', 'status'); nodes.push(notice);
    }
    nodes.push(layout);
    const updated = element('p', 'last-updated'); updated.setAttribute('part', 'last-updated');
    const timestamp = this.snapshot.fetchedAt || this.snapshot.generatedAt;
    const time = element('time', '', new Intl.DateTimeFormat('en-AU', {
      timeZone: this.timezone, dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(timestamp)));
    time.dateTime = timestamp;
    updated.append(document.createTextNode('Last updated: '), time);
    nodes.push(updated); this.main.replaceChildren(...nodes);
    if (focusedAction) [...this.main.querySelectorAll('[data-action]')].find((n) => n.dataset.action === focusedAction)?.focus({ preventScroll: true });
    if (focusedDay) [...this.main.querySelectorAll('[data-day]')].find((n) => n.dataset.day === focusedDay)?.focus({ preventScroll: true });
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
    for (const event of this.upcomingEvents()) {
      const key = eventDates(event, this.timezone).start;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const day of monthDays(this.selectedMonth)) {
      const classes = day.key === this.today ? 'today' : '';
      const button = element('button', classes, String(day.day)); button.dataset.day = day.key; button.setAttribute('part', 'day');
      button.disabled = day.key < this.today;
      const count = counts.get(day.key) || 0;
      button.setAttribute('aria-label', `${labelDate(day.key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${count ? `, ${count} event${count === 1 ? '' : 's'}` : ''}`);
      if (day.key === this.today) button.setAttribute('aria-current', 'date');
      if (count) { const dot = element('span', 'dot'); dot.setAttribute('aria-hidden', 'true'); button.append(dot); }
      days.append(button);
    }
    const today = element('button', 'today-button', 'Today'); today.dataset.action = 'today';
    nav.append(days, today);
    return nav;
  }

  renderList() {
    const list = element('div', 'list'); list.setAttribute('part', 'list');
    const events = this.upcomingEvents();
    const announcement = element('div', 'sr-only', `${events.length} upcoming events from today.`);
    announcement.setAttribute('role', 'status'); list.append(announcement);
    let month, day, monthSection, daySection;
    const describedEvents = new Set();
    for (const event of events) {
      const dates = eventDates(event, this.timezone);
      // Ongoing events appear under today, independently of the picker month.
      const groupDay = dates.start < this.today ? this.today : dates.start;
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
      const title = element('div', 'event-title', event.title);
      title.setAttribute('part', 'event-title');
      row.append(title);
      const subtitle = eventSubtitle(event, this.timezone);
      if (subtitle) { const time = element('div', 'metadata', subtitle); time.setAttribute('part', 'event-time'); row.append(time); }
      const registrationUrl = httpsUrl(event.registrationUrl);
      if (event.location || registrationUrl) {
        const links = element('div', 'event-links');
        if (event.location) {
          const location = element('span'); location.setAttribute('part', 'event-location');
          const pin = element('span', '', '📍 '); pin.setAttribute('aria-hidden', 'true');
          location.append(pin, element('span', 'sr-only', 'Location: '), document.createTextNode(event.location));
          links.append(location);
        }
        if (event.location && registrationUrl) links.append(document.createTextNode(' · '));
        if (registrationUrl) {
          const link = externalLink('Register', registrationUrl); link.setAttribute('part', 'event-registration');
          link.setAttribute('aria-label', `Register for ${event.title} (opens in a new tab)`); links.append(link);
        }
        row.append(links);
      }
      // The Planning Center parent event identifies a series. Never merge
      // unrelated events just because their names or descriptions happen to match.
      const series = event.eventId || event.id;
      const description = additionalDescription(event, this.timezone);
      if (!describedEvents.has(series) && description) {
        const text = element('div', 'description', description); text.setAttribute('part', 'description');
        row.append(text);
      }
      describedEvents.add(series);
      daySection.append(row);
    }
    if (!events.length) list.append(element('p', '', 'No upcoming events in this period.'));
    return list;
  }

  updateNavigation() {
    // Keep the event list mounted so picker changes cannot disturb its scroll
    // position or remove the focused event during a navigation update.
    const active = this.shadowRoot.activeElement;
    const navigation = this.main.querySelector('.navigation');
    navigation.replaceWith(this.renderNavigation());
    if (active?.hasAttribute('data-month-select')) this.main.querySelector('select')?.focus({ preventScroll: true });
    if (active?.dataset?.action) [...this.main.querySelectorAll('[data-action]')].find((node) => node.dataset.action === active.dataset.action)?.focus({ preventScroll: true });
    if (active?.dataset?.day) [...this.main.querySelectorAll('[data-day]')].find((node) => node.dataset.day === active.dataset.day)?.focus({ preventScroll: true });
  }

  scrollToSection(section) {
    // scrollIntoView also scrolls the host webpage. Only move a scroll box
    // inside this component (including the host itself); never an ancestor page.
    for (let container = section.parentElement; container; container = container.parentElement || (container.getRootNode().host === this ? this : null)) {
      const style = getComputedStyle(container);
      if (/(auto|scroll)/.test(style.overflowY) && container.scrollHeight > container.clientHeight) {
        const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
        const top = container.scrollTop + section.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop - margin;
        container.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
        break;
      }
      if (container === this) break;
    }
    section.focus({ preventScroll: true });
  }

  selectMonth(key, focusAction) {
    if (key < this.minMonth || key > this.maxMonth) return;
    this.selectedMonth = key; this.selectedDay = null; this.updateNavigation();
    if (focusAction === 'select') this.main.querySelector('select')?.focus({ preventScroll: true });
  }

  onClick(event) {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.hasAttribute('data-retry')) { this.load(); return; }
    if (!this.hasSnapshot()) { this.clearSnapshot(); this.load(); return; }
    if (target.dataset.action === 'next') this.selectMonth(monthShift(this.selectedMonth, 1));
    if (target.dataset.action === 'prev') this.selectMonth(monthShift(this.selectedMonth, -1));
    if (target.dataset.action === 'today') this.selectMonth(this.minMonth);
    if (target.dataset.day) {
      this.selectedDay = target.dataset.day; this.updateNavigation();
      const section = [...this.main.querySelectorAll('[data-date]')].find((node) => node.dataset.date >= this.selectedDay);
      if (section) this.scrollToSection(section);
    }
  }

}

if (!customElements.get('church-calendar')) customElements.define('church-calendar', ChurchCalendar);
