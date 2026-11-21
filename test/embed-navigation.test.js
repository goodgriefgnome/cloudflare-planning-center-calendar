import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement = class {};
globalThis.customElements = { get() {}, define() {} };
// A small DOM stand-in for checking rendered grouping, without a layout engine.
class Node {
  children = []; dataset = {}; attributes = {};
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
}
globalThis.document = { createElement() { return new Node(); } };
globalThis.getComputedStyle = (node) => node.style || { overflowY: 'visible', scrollMarginTop: '16px' };
const { ChurchCalendar } = await import('../public/embed.js');
const now = Date.parse('2026-11-21T12:00:00Z');
function event(id, start, end = start) {
  return { id, title: id, allDay: true, startDate: start, endDate: end,
    start: `${start}T00:00:00Z`, end: `${end}T23:59:59Z` };
}
function component() {
  return Object.assign(Object.create(ChurchCalendar.prototype), {
    today: '2026-11-21', timezone: 'UTC', selectedMonth: '2026-11', minMonth: '2026-11', maxMonth: '2027-11',
    snapshot: { events: [event('past', '2026-11-20'), event('ongoing', '2026-11-20', '2026-11-22'),
      event('nov', '2026-11-29'), event('dec', '2026-12-06'), event('jan', '2027-01-03')] },
  });
}

test('picker month never filters upcoming events or changes their day groups', (t) => {
  t.mock.method(Date, 'now', () => now);
  const view = component();
  const before = view.renderList();
  view.selectedMonth = '2027-01';
  assert.deepEqual(view.upcomingEvents().map((item) => item.id), ['ongoing', 'nov', 'dec', 'jan']);
  const after = view.renderList();
  const groups = (list) => list.children.filter((node) => node.dataset.month).map((month) =>
    [month.dataset.month, month.children.filter((node) => node.dataset.date).map((day) => day.dataset.date)]);
  assert.deepEqual(groups(after), groups(before));
  assert.deepEqual(groups(after), [['2026-11', ['2026-11-21', '2026-11-29']], ['2026-12', ['2026-12-06']], ['2027-01', ['2027-01-03']]]);
});

test('month changes update only navigation and retain the mounted list', () => {
  const view = component(); let updates = 0;
  view.updateNavigation = () => updates++;
  view.render = () => assert.fail('must not replace the event list');
  view.selectedDay = '2026-11-29';
  view.selectMonth('2026-12');
  assert.equal(view.selectedMonth, '2026-12'); assert.equal(view.selectedDay, null); assert.equal(updates, 1);
  view.selectMonth('2028-01'); assert.equal(updates, 1);
});

function scrollFixture(overflowY = 'auto') {
  const view = component(); const calls = [];
  Object.assign(view, { style: { overflowY }, scrollHeight: 2000, clientHeight: 650, clientTop: 2, scrollTop: 120,
    getBoundingClientRect: () => ({ top: 300 }), scrollTo: (options) => calls.push(options) });
  // An outer scroller must never be touched, even if the host isn't scrollable.
  view.parentElement = { get style() { assert.fail('must not inspect or scroll the host webpage'); } };
  const main = { parentElement: null, getRootNode: () => ({ host: view }) };
  const section = { parentElement: main, getBoundingClientRect: () => ({ top: 900 }),
    focus: (options) => { assert.deepEqual(options, { preventScroll: true }); section.focused = true; } };
  return { view, section, calls };
}

test('date jumps scroll only the host scroll box and account for offset and border', () => {
  const { view, section, calls } = scrollFixture();
  view.scrollToSection(section);
  assert.deepEqual(calls, [{ top: 702, behavior: 'instant' }]); assert.equal(section.focused, true);
});

test('without internal scrolling, date selection focuses without moving the webpage', () => {
  const { view, section, calls } = scrollFixture('visible');
  view.scrollToSection(section);
  assert.deepEqual(calls, []); assert.equal(section.focused, true);
});

test('a nested internal scroll box is preferred over the host scroll box', () => {
  const { view, section, calls } = scrollFixture(); const innerCalls = [];
  section.parentElement = { parentElement: view, style: { overflowY: 'auto' }, scrollHeight: 1200, clientHeight: 400,
    clientTop: 0, scrollTop: 50, getBoundingClientRect: () => ({ top: 500 }), scrollTo: (options) => innerCalls.push(options) };
  view.scrollToSection(section);
  assert.deepEqual(innerCalls, [{ top: 434, behavior: 'instant' }]); assert.deepEqual(calls, []);
});

test('date button keeps the list mounted and jumps to the next available day', () => {
  const view = component(); let updates = 0, destination;
  const sections = [{ dataset: { date: '2026-11-29' } }, { dataset: { date: '2026-12-06' } }];
  view.main = { querySelectorAll: () => sections };
  view.updateNavigation = () => updates++;
  view.render = () => assert.fail('must not replace the event list');
  view.scrollToSection = (section) => { destination = section; };
  const button = { dataset: { day: '2026-12-01' }, hasAttribute: () => false };
  view.onClick({ target: { closest: () => button } });
  assert.equal(updates, 1); assert.equal(destination, sections[1]);
});
