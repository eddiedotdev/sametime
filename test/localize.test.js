import test from 'node:test';
import assert from 'node:assert/strict';
import { localize } from '../src/localize.js';

const PHOENIX = 'America/Phoenix';
const ts = String(Date.parse('2026-10-01T23:30:00Z') / 1000);
const seconds = iso => Date.parse(iso) / 1000;

const message = (text, style) => ({
  text,
  ts,
  blocks: [{
    type: 'rich_text',
    block_id: 'original',
    elements: [{
      type: 'rich_text_section',
      elements: [{ type: 'text', text, ...(style ? { style } : {}) }, { type: 'user', user_id: 'U123' }],
    }],
  }],
});
const dates = result => result.blocks[0].elements[0].elements.filter(element => element.type === 'date');

test('converts an exact date in sender zone and preserves surrounding text, style and mentions', () => {
  const original = message('Meet 2026-10-02 at 3:00 PM. Thanks!', { bold: true });
  const saved = structuredClone(original);
  const result = localize(original, PHOENIX);
  const [date] = dates(result);

  assert.equal(date.timestamp, seconds('2026-10-02T22:00:00Z'));
  assert.equal(date.format, '{date_num} at {time}');
  assert.equal(date.timezone, undefined);
  assert.equal(date.style.bold, true);
  assert.match(date.fallback, /America\/Phoenix/);
  assert.match(result.text, /<!date\^\d+\^\{date_num\} at \{time\}\|/);
  assert.equal(result.blocks[0].elements[0].elements[0].text, 'Meet ');
  assert.deepEqual(result.blocks[0].elements[0].elements.at(-1), { type: 'user', user_id: 'U123' });
  assert.deepEqual(original, saved);
});

test('today and tomorrow use message date in sender zone, including midnight rollover', () => {
  const lateEvening = message('tomorrow at 9 AM');
  lateEvening.ts = String(seconds('2026-10-02T01:30Z'));
  assert.equal(dates(localize(lateEvening, PHOENIX))[0].timestamp, seconds('2026-10-02T16:00Z'));
  assert.equal(dates(localize(message('today at 16:30'), PHOENIX))[0].timestamp, seconds('2026-10-01T23:30Z'));
});

test('relative input selects native pretty formatting in blocks and text without changing the instant', () => {
  const cases = [
    ['today at 3 PM', '2026-10-01 at 3 PM'],
    ['tomorrow at 3 PM', '2026-10-02 at 3 PM'],
    ['ToMoRrOw at 3 PM', '2026-10-02 at 3 PM'],
  ];
  for (const [text, explicit] of cases) {
    const result = localize(message(`Meet ${text}.`, { italic: true }), PHOENIX);
    const [date] = dates(result);
    assert.equal(date.format, '{date_short_pretty} at {time}');
    assert.match(result.text, /\^\{date_short_pretty\} at \{time\}\|/);
    assert.equal(date.timestamp, dates(localize(message(explicit), PHOENIX))[0].timestamp);
    assert.equal(date.fallback, `${explicit.slice(0, 10)} 15:00 America/Phoenix`);
    assert.equal(date.timezone, undefined);
    assert.deepEqual(date.style, { italic: true });
  }
});

test('relative formatting delegates viewer midnight labels to Slack with an absolute timestamp and fallback', () => {
  const original = message('tomorrow at 11:30 PM');
  // In Phoenix this was sent Oct 1; UTC and East Coast already have Oct 2.
  original.ts = String(seconds('2026-10-02T04:30Z'));
  const result = localize(original, PHOENIX);
  const [date] = dates(result);

  assert.equal(date.timestamp, seconds('2026-10-03T06:30Z'));
  assert.equal(date.format, '{date_short_pretty} at {time}');
  assert.equal(date.fallback, '2026-10-02 23:30 America/Phoenix');
  assert.equal(result.text, `<!date^${date.timestamp}^{date_short_pretty} at {time}|2026-10-02 23:30 America/Phoenix>`);
});

test('skips ambiguous, malformed, explicitly zoned, code and quoted expressions', () => {
  const skipped = [
    '10/02 at 3 PM',
    'next Friday at 3 PM',
    '2026-02-30 at 3 PM',
    '2026-10-02 at 25:00',
    'today at 3',
    'tomorrow at 3 PM ET',
    '2026-10-02 at 3 PM UTC',
    'https://example.com/2026-10-02 at 3 PM',
  ];
  for (const text of skipped) assert.equal(localize(message(text), PHOENIX), null, text);

  assert.equal(localize(message('today at 3 PM', { code: true }), PHOENIX), null);
  const quote = message('today at 3 PM');
  quote.blocks[0].elements[0].type = 'rich_text_quote';
  assert.equal(localize(quote, PHOENIX), null);
  assert.equal(localize(message('today at 3 PM'), 'Invalid/Zone'), null);
});

test('skips explicit offsets and zones after the time', () => {
  const skipped = [
    'today at 15:00+02:00',
    'today at 15:00 -0700',
    'today at 3 PM (America/New_York)',
  ];
  for (const text of skipped) assert.equal(localize(message(text), PHOENIX), null, text);
});

test('skips nonexistent and repeated DST times', () => {
  for (const text of ['2026-03-08 at 2:30 AM', '2026-11-01 at 1:30 AM']) {
    assert.equal(localize(message(text), 'America/New_York'), null, text);
  }
});

test('preserves attachment blocks and does not reprocess a native date', () => {
  const original = message('today at 3 PM');
  original.blocks.push({ type: 'image', image_url: 'https://example.com/image.png', alt_text: 'Test' });
  const result = localize(original, PHOENIX);
  assert.deepEqual(result.blocks[1], original.blocks[1]);
  assert.equal(localize({ ...original, ...result }, PHOENIX), null);
});

test('rejects lower-case or parenthesized explicit zones and unsupported seconds', () => {
  const skipped = ['tomorrow at 3 PM est', 'tomorrow at 3 PM (ET)', 'today at 15:30:45', '2026-10-02 at 3 PM America/New_York'];
  for (const text of skipped) assert.equal(localize(message(text), PHOENIX), null, text);
});

test('bare AM/PM and complete 24-hour times default to the original sender-local date', () => {
  const cases = [
    ['3pm', '2026-10-01T22:00Z'], ['3 PM', '2026-10-01T22:00Z'],
    ['3:30pm', '2026-10-01T22:30Z'], ['at 3pM', '2026-10-01T22:00Z'],
    ['15:00', '2026-10-01T22:00Z'], ['9:05', '2026-10-01T16:05Z'],
    ['0:00', '2026-10-01T07:00Z'], ['12am', '2026-10-01T07:00Z'],
    ['12 PM', '2026-10-01T19:00Z'],
  ];
  for (const [text, expected] of cases) {
    const result = localize(message(`Meet ${text}.`), PHOENIX);
    assert.ok(result, text);
    const [date] = dates(result);
    assert.equal(date.timestamp, seconds(expected), text);
    assert.equal(date.format, '{date_short_pretty} at {time}');
    assert.equal(date.timezone, undefined);
    assert.match(result.text, /\^\{date_short_pretty\} at \{time\}\|/);
    assert.equal(result.blocks[0].elements[0].elements[0].text, 'Meet ');
  }
});

test('day and explicit date prefixes work with or without at, ignoring input case', () => {
  for (const text of ['today 3pm', 'ToDaY 3 PM', 'today AT 3:00pm']) {
    const result = localize(message(text), PHOENIX); assert.ok(result, text);
    assert.equal(dates(result)[0].timestamp, seconds('2026-10-01T22:00Z'));
  }
  for (const text of ['tomorrow 3 PM', 'ToMoRrOw 15:00', 'tomorrow at 3pm']) {
    const result = localize(message(text), PHOENIX); assert.ok(result, text);
    assert.equal(dates(result)[0].timestamp, seconds('2026-10-02T22:00Z'));
  }
  for (const text of ['2026-10-02 3pm', '2026-10-02 15:00', '2026-10-02 at 3 PM']) {
    const result = localize(message(text), PHOENIX); assert.ok(result, text);
    assert.equal(dates(result)[0].timestamp, seconds('2026-10-02T22:00Z'));
    assert.equal(dates(result)[0].format, '{date_num} at {time}');
  }
});

test('bare times use the sender date around midnight and never roll a past time forward', () => {
  const beforeMidnight = message('8am');
  beforeMidnight.ts = String(seconds('2026-10-02T06:30Z')); // Oct 1 23:30 Phoenix
  const result = localize(beforeMidnight, PHOENIX); assert.ok(result);
  assert.equal(dates(result)[0].timestamp, seconds('2026-10-01T15:00Z'));
  assert.equal(dates(result)[0].fallback, '2026-10-01 08:00 America/Phoenix');
  const afterMidnight = {...beforeMidnight, ts:String(seconds('2026-10-02T07:30Z'))};
  assert.equal(dates(localize(afterMidnight, PHOENIX))[0].timestamp, seconds('2026-10-02T15:00Z'));
  const lateTime = {...message('11:30pm'), ts:beforeMidnight.ts};
  const lateDate = dates(localize(lateTime, PHOENIX))[0];
  assert.equal(lateDate.timestamp, seconds('2026-10-02T06:30Z'));
  assert.equal(lateDate.format, '{date_short_pretty} at {time}');
  assert.equal(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(lateDate.timestamp*1000)), '2026-10-02');
});

test('new forms skip unqualified numbers, malformed clocks, date hints, zones and dangling numbers', () => {
  const skipped = [
    'meet 3', 'today 3', 'tomorrow at 3', '0pm', '13pm', '24:00', '3:60pm',
    '1:2pm', '3:00:45', '3.00pm', '123:30', '003pm',
    'next Friday 3pm', 'tomorrow we meet at 3pm', 'yesterday at 3pm',
    '10/02 3pm', 'October 2 at 3pm', '2026-02-30 3pm',
    '3pm ET', '3 PM (est)', 'PT 3pm', '3pm Eastern', 'Pacific at 3pm', '15:00+02:00', '15:00 -0700',
    '3 or 4pm', '3pm to 4', 'https://example.com/3pm',
  ];
  for (const text of skipped) assert.equal(localize(message(text), PHOENIX), null, text);
  const numericProse = localize(message('Bring 3 notebooks at 3pm.'), PHOENIX);
  assert.ok(numericProse);
  assert.equal(dates(numericProse)[0].timestamp, seconds('2026-10-01T22:00Z'));
});

test('bare times preserve prose, formatting and native case control, and skip code and quotes', () => {
  const original = message('million dollar bonus today 3pm', {bold:true});
  const result = localize(original, PHOENIX); assert.ok(result);
  assert.equal(result.blocks[0].elements[0].elements[0].text, 'million dollar bonus ');
  assert.equal(dates(result)[0].format, '{date_short_pretty} at {time}');
  assert.deepEqual(dates(result)[0].style, {bold:true});
  assert.equal(localize(message('3pm', {code:true}), PHOENIX), null);
  const quote = message('3pm'); quote.blocks[0].elements[0].type = 'rich_text_quote';
  assert.equal(localize(quote, PHOENIX), null);
  const dst = {...message('2:30am'), ts:String(seconds('2026-03-08T12:00Z'))};
  assert.equal(localize(dst, 'America/New_York'), null);
});

const RELATIVE = '{date_short_pretty} at {time}';
const EXACT = '{date_num} at {time}';
const TIME_ONLY = '{time}';
const summary = result => dates(result).map(date => [new Date(date.timestamp * 1000).toISOString().slice(0, 16) + 'Z', date.format]);

test('a range becomes a start and an end date element around the original separator', () => {
  const original = message('Free 3-4 PM. Thanks!', { bold: true });
  const saved = structuredClone(original);
  const result = localize(original, PHOENIX);
  const [start, end] = dates(result);

  assert.deepEqual(result.blocks[0].elements[0].elements, [
    { type: 'text', text: 'Free ', style: { bold: true } },
    { type: 'date', timestamp: seconds('2026-10-01T22:00Z'), format: RELATIVE, fallback: '2026-10-01 15:00 America/Phoenix', style: { bold: true } },
    { type: 'text', text: '-', style: { bold: true } },
    { type: 'date', timestamp: seconds('2026-10-01T23:00Z'), format: TIME_ONLY, fallback: '2026-10-01 16:00 America/Phoenix', style: { bold: true } },
    { type: 'text', text: '. Thanks!', style: { bold: true } },
    { type: 'user', user_id: 'U123' },
  ]);
  assert.equal(result.text, `Free <!date^${start.timestamp}^${RELATIVE}|${start.fallback}>-<!date^${end.timestamp}^${TIME_ONLY}|${end.fallback}>. Thanks!`);
  assert.deepEqual(original, saved);
});

test('ranges accept dashes and words, borrow AM/PM for the start, and take a leading date', () => {
  const cases = [
    ['3pm-4pm', '2026-10-01T22:00Z', '2026-10-01T23:00Z', RELATIVE],
    ['3 PM to 5 PM', '2026-10-01T22:00Z', '2026-10-02T00:00Z', RELATIVE],
    ['3—4pm', '2026-10-01T22:00Z', '2026-10-01T23:00Z', RELATIVE],
    ['3 until 4pm', '2026-10-01T22:00Z', '2026-10-01T23:00Z', RELATIVE],
    ['9:30-10 AM', '2026-10-01T16:30Z', '2026-10-01T17:00Z', RELATIVE],
    ['15:00-16:30', '2026-10-01T22:00Z', '2026-10-01T23:30Z', RELATIVE],
    ['tomorrow at 3 PM – 4 PM', '2026-10-02T22:00Z', '2026-10-02T23:00Z', RELATIVE],
    ['2026-10-02 3-4pm', '2026-10-02T22:00Z', '2026-10-02T23:00Z', EXACT],
  ];
  for (const [text, start, end, format] of cases) {
    const result = localize(message(`Busy ${text}.`), PHOENIX);
    assert.ok(result, text);
    assert.deepEqual(summary(result), [[start, format], [end, TIME_ONLY]], text);
  }
});

test('a borrowed AM/PM flips for the start when the start would not precede the end', () => {
  const cases = [
    ['11-1 PM', '2026-10-01T18:00Z', '2026-10-01T20:00Z'],
    ['10-5 PM', '2026-10-01T17:00Z', '2026-10-02T00:00Z'],
    ['12-1 PM', '2026-10-01T19:00Z', '2026-10-01T20:00Z'],
  ];
  for (const [text, start, end] of cases) {
    assert.deepEqual(summary(localize(message(text), PHOENIX)), [[start, RELATIVE], [end, TIME_ONLY]], text);
  }
});

test('a range that runs past midnight ends on the next sender-local day', () => {
  const cases = [
    ['11 PM - 1 AM', '2026-10-02T06:00Z', '2026-10-02T08:00Z'],
    ['11-1 AM', '2026-10-02T06:00Z', '2026-10-02T08:00Z'],
    ['22:00-02:00', '2026-10-02T05:00Z', '2026-10-02T09:00Z'],
  ];
  for (const [text, start, end] of cases) {
    const result = localize(message(text), PHOENIX);
    assert.deepEqual(summary(result), [[start, RELATIVE], [end, TIME_ONLY]], text);
  }
  assert.equal(dates(localize(message('11 PM - 1 AM'), PHOENIX))[1].fallback, '2026-10-02 01:00 America/Phoenix');
});

test('skips ranges with mixed clock styles, equal ends, zones, chains or invalid DST times', () => {
  const skipped = [
    '3pm to 4', '3pm-16:00', '15:00-4pm', '13-2 PM', '0-2 PM', '4-4pm', '3 PM - 3 PM', '15:00-15:00',
    '3-4 PM EST', '3-4 PM (ET)', 'ET 3-4 PM', '3-4-5 PM', '3-4 PM-5 PM', '3 or 4pm', '3-4:60 PM',
    'Friday 3-4 PM', '3-4 PM tomorrow',
  ];
  for (const text of skipped) assert.equal(localize(message(text), PHOENIX), null, text);
  for (const text of ['2026-03-08 1-2:30 AM', '2026-03-08 2:30-4 AM', '2026-11-01 1:30-3 AM', '2026-11-01 12:30-1:30 AM']) {
    assert.equal(localize(message(text), 'America/New_York'), null, text);
  }
});

test('alternatives joined by or, and or a comma share the first time’s date and show only the time', () => {
  const cases = [
    ['today at 3 PM or 4 PM', [['2026-10-01T22:00Z', RELATIVE], ['2026-10-01T23:00Z', TIME_ONLY]]],
    ['tomorrow at 3 PM or 5 PM', [['2026-10-02T22:00Z', RELATIVE], ['2026-10-03T00:00Z', TIME_ONLY]]],
    ['2026-10-05 at 9 AM, 11 AM, or 2 PM', [['2026-10-05T16:00Z', EXACT], ['2026-10-05T18:00Z', TIME_ONLY], ['2026-10-05T21:00Z', TIME_ONLY]]],
    ['3pm and 5pm', [['2026-10-01T22:00Z', RELATIVE], ['2026-10-02T00:00Z', TIME_ONLY]]],
    ['3pm, 16:00', [['2026-10-01T22:00Z', RELATIVE], ['2026-10-01T23:00Z', TIME_ONLY]]],
    ['tomorrow 9-10 AM or 3-4 PM', [
      ['2026-10-02T16:00Z', RELATIVE], ['2026-10-02T17:00Z', TIME_ONLY],
      ['2026-10-02T22:00Z', TIME_ONLY], ['2026-10-02T23:00Z', TIME_ONLY],
    ]],
  ];
  for (const [text, expected] of cases) {
    const result = localize(message(text), PHOENIX);
    assert.ok(result, text);
    assert.deepEqual(summary(result), expected, text);
  }
  const kept = localize(message('tomorrow at 3 PM or at 5 PM'), PHOENIX);
  assert.deepEqual(kept.blocks[0].elements[0].elements.slice(0, 3).map(element => element.text ?? element.format), [RELATIVE, ' or at ', TIME_ONLY]);
});

test('separate times each keep their own date, and undated ones mean the send date', () => {
  const cases = [
    ['call at 9:30, lunch at 12:30', [['2026-10-01T16:30Z', RELATIVE], ['2026-10-01T19:30Z', RELATIVE]]],
    ['today 3pm and tomorrow 9am', [['2026-10-01T22:00Z', RELATIVE], ['2026-10-02T16:00Z', RELATIVE]]],
    ['today 3pm to tomorrow 9am', [['2026-10-01T22:00Z', RELATIVE], ['2026-10-02T16:00Z', RELATIVE]]],
    ['Demo at 3 PM. Retro 2026-10-02 at 10 AM', [['2026-10-01T22:00Z', RELATIVE], ['2026-10-02T17:00Z', EXACT]]],
    ['today at 1 PM I am out. Back by 2 PM', [['2026-10-01T20:00Z', RELATIVE], ['2026-10-01T21:00Z', RELATIVE]]],
  ];
  for (const [text, expected] of cases) {
    const result = localize(message(text), PHOENIX);
    assert.ok(result, text);
    assert.deepEqual(summary(result), expected, text);
  }
});

test('skips the whole message when any of several times is ambiguous or invalid', () => {
  const skipped = [
    'tomorrow at 3 PM. Done by 5 PM',
    '2026-10-05 at 3 PM, then dinner 7 PM',
    '3 PM or 5 PM ET',
    '3 PM ET or 5 PM',
    'call 9:30 and 25:00',
    '3 PM or 4',
    '3pm/4pm',
    'Friday at 3 PM or 4 PM',
  ];
  for (const text of skipped) assert.equal(localize(message(text), PHOENIX), null, text);
});

test('several times are replaced across separately formatted text elements and skipped if one is in code', () => {
  const original = message('Call 9:30 AM then ');
  original.text = 'Call 9:30 AM then *lunch 12:30 PM*';
  original.blocks[0].elements[0].elements.splice(1, 0, { type: 'text', text: 'lunch 12:30 PM', style: { bold: true } });
  const result = localize(original, PHOENIX);
  assert.deepEqual(summary(result), [['2026-10-01T16:30Z', RELATIVE], ['2026-10-01T19:30Z', RELATIVE]]);
  assert.deepEqual(dates(result).map(date => date.style), [undefined, { bold: true }]);
  assert.equal(result.blocks[0].elements[0].elements[3].text, 'lunch ');

  const withCode = structuredClone(original);
  withCode.text = 'Call 9:30 AM then `lunch 12:30 PM`';
  withCode.blocks[0].elements[0].elements[1].style = { code: true };
  assert.equal(localize(withCode, PHOENIX), null);
});

test('from is accepted like at before a time, with or without a leading day', () => {
  const cases = [
    ["yeah I'm free later today from 3-4 PM", "yeah I'm free later ", [['2026-10-01T22:00Z', RELATIVE], ['2026-10-01T23:00Z', TIME_ONLY]]],
    ['free from 3pm to 4pm', 'free ', [['2026-10-01T22:00Z', RELATIVE], ['2026-10-01T23:00Z', TIME_ONLY]]],
    ['out tomorrow from 9:30', 'out ', [['2026-10-02T16:30Z', RELATIVE]]],
  ];
  for (const [text, leading, expected] of cases) {
    const result = localize(message(text), PHOENIX);
    assert.ok(result, text);
    assert.equal(result.blocks[0].elements[0].elements[0].text, leading, text);
    assert.deepEqual(summary(result), expected, text);
  }
});
