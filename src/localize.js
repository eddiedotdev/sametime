import { DateTime, IANAZone } from 'luxon';

// Only AM/PM clocks or complete H:mm clocks qualify; ordinary numbers do not.
// A missing day means the sender-local send date. "at" or "from" is optional.
// A range start may be a bare hour that borrows AM/PM from the end: "3-4 PM".
const CLOCK = String.raw`\d{1,2}(?::\d{2})?[ \t]*(?:AM|PM)|\d{1,2}:\d{2}`;
const RANGE_START = String.raw`\d{1,2}(?::\d{2})?(?:[ \t]*(?:AM|PM))?`;
const RANGE_SEPARATOR = String.raw`[ \t]*[-–—][ \t]*|[ \t]+(?:to|until|till|through)[ \t]+`;
const TIME_EXPRESSION = new RegExp(
  String.raw`\b(?:(?<date>\d{4}-\d{2}-\d{2}|today|tomorrow)[ \t]+(?:(?:at|from)[ \t]+)?|(?:at|from)[ \t]+)?(?:(?<start>${RANGE_START})(?:${RANGE_SEPARATOR}))?(?<end>${CLOCK})\b`,
  'dgi',
);
const CLOCK_PARTS = /^(\d{1,2})(?::(\d{2}))?(?:[ \t]*(AM|PM))?$/i;

// Only these joiners let a time without a date share the previous time's date.
const ALTERNATIVE_JOINER = /^[ \t]*(?:,[ \t]*(?:or|and)?|or|and|&)[ \t]*$/i;

// Do not reinterpret a clock attached to an unsupported day/date as today's time.
const OTHER_DATE_HINTS = /\b(?:today|tomorrow|yesterday|tonight|(?:mon|tues|wednes|thurs|fri|satur|sun)day|next[ \t]+(?:week|month)|this[ \t]+(?:morning|afternoon|evening))\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i;
const MONTH_DATE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[ \t]+\d{1,2}\b|\b\d{1,2}[ \t]+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const ZONE_PREFIX = /(?:\b(?:[ecmp][ds]?t|utc|gmt|bst|cet|cest|ist|jst|aest|aedt|eastern|central|mountain|pacific)|[A-Za-z_]+\/[A-Za-z_/]+)[ \t]*$/i;
const UNSUPPORTED_PREFIX = /[\d:\/+-][ \t]*$|\d\.[ \t]*$|\.$|\d[ \t]*(?:[-–—]|or|to|and|until|through|till)[ \t]*$/i;

// Text after the time that needs more context than this POC has:
// explicit zones or offsets, dangling numbers such as "3 PM to 4", and seconds.
const UNSUPPORTED_SUFFIXES = [
  /^\s*(?:[A-Z]{2,5}\b|[+-]\d|(?:or|to|and|until|through|till)\s+\d|[-–—]\s*\d)/,
  /^\s*\(?\s*(?:[A-Za-z_]+\/[A-Za-z_/]+|(?:[ecmp][ds]?t|utc|gmt|bst|cet|cest|ist|jst|aest|aedt|eastern|central|mountain|pacific)\b)/i,
  /^[:.]\d/,
];

// URLs may contain date-like text; native dates are already localized.
const UNSUPPORTED_MESSAGE = /https?:\/\/|<!date\^/;

const RELATIVE_FORMAT = '{date_short_pretty} at {time}';
const EXACT_FORMAT = '{date_num} at {time}';
const TIME_FORMAT = '{time}';

export function localize(message, zone) {
  if (!IANAZone.isValidZone(zone) || !Array.isArray(message.blocks) || typeof message.text !== 'string') return null;
  if (UNSUPPORTED_MESSAGE.test(message.text)) return null;
  const sentAt = DateTime.fromSeconds(Number(message.ts), { zone });
  if (!sentAt.isValid) return null;

  const { text } = message;
  const matches = [...text.matchAll(TIME_EXPRESSION)];
  if (matches.length === 0) return null;

  // One unsupported time skips the whole message; it is never partly converted.
  const expressions = [];
  matches.forEach((match, index) => {
    const prefix = text.slice(index ? matchEnd(matches[index - 1]) : 0, match.index);
    const suffix = text.slice(matchEnd(match), matches[index + 1]?.index);
    expressions.push(isSupportedContext(prefix, suffix) ? resolveExpression(match, prefix, expressions.at(-1), sentAt, zone) : null);
  });
  if (expressions.some(expression => !expression)) return null;

  const blocks = replaceInBlocks(message.blocks, expressions);
  if (!blocks) return null;

  let localized = text;
  for (let index = matches.length - 1; index >= 0; index--) {
    for (const { start, end, element } of expressions[index].replacements.toReversed()) {
      const from = matches[index].index + start;
      const to = matches[index].index + end;
      const markup = `<!date^${element.timestamp}^${element.format}|${element.fallback}>`;
      localized = localized.slice(0, from) + markup + localized.slice(to);
    }
  }
  return { blocks, text: localized };
}

function matchEnd(match) {
  return match.index + match[0].length;
}

function isRelative(dateText) {
  return !/^\d/.test(dateText);
}

function isSupportedContext(prefix, suffix) {
  const surrounding = `${prefix} ${suffix}`;
  if (OTHER_DATE_HINTS.test(surrounding) || MONTH_DATE.test(surrounding)) return false;
  if (ZONE_PREFIX.test(prefix) || UNSUPPORTED_PREFIX.test(prefix)) return false;
  return !UNSUPPORTED_SUFFIXES.some(pattern => pattern.test(suffix));
}

// Returns the matched text, its date, and the date elements that replace its clocks
// (offsets are relative to the match), or null when it is invalid or ambiguous.
function resolveExpression(match, prefix, previous, sentAt, zone) {
  let dateText = match.groups.date;
  let format;
  if (!dateText && previous && ALTERNATIVE_JOINER.test(prefix)) {
    // "tomorrow at 3 PM or 5 PM": the alternative shares the date and shows only its time.
    dateText = previous.dateText;
    format = TIME_FORMAT;
  } else if (!dateText && previous && previous.dateText.toLowerCase() !== 'today') {
    // "tomorrow at 3 PM. Done by 5 PM": unclear whether 5 PM is today or tomorrow.
    return null;
  }
  dateText ??= 'today';
  format ??= isRelative(dateText) ? RELATIVE_FORMAT : EXACT_FORMAT;

  const minutes = clockMinutes(match.groups.start, match.groups.end);
  if (!minutes) return null;
  const [startMinutes, endMinutes] = minutes;
  const date = isRelative(dateText)
    ? sentAt.plus({ days: dateText.toLowerCase() === 'tomorrow' ? 1 : 0 })
    : DateTime.fromISO(dateText, { zone });
  if (!date.isValid) return null;

  const offset = index => index - match.index;
  const [clockStart, clockEnd] = match.indices.groups.end;
  // A shared date keeps its own "at"; otherwise the format supplies it.
  const firstStart = format === TIME_FORMAT ? offset((match.indices.groups.start ?? match.indices.groups.end)[0]) : 0;

  let replacements;
  if (startMinutes === undefined) {
    replacements = [{ start: firstStart, end: offset(clockEnd), instant: resolveInstant(date, endMinutes, zone), format }];
  } else {
    // A range ending at or before its start time runs past midnight.
    const endDate = endMinutes > startMinutes ? date : date.plus({ days: 1 });
    replacements = [
      { start: firstStart, end: offset(match.indices.groups.start[1]), instant: resolveInstant(date, startMinutes, zone), format },
      { start: offset(clockStart), end: offset(clockEnd), instant: resolveInstant(endDate, endMinutes, zone), format: TIME_FORMAT },
    ];
  }
  if (replacements.some(({ instant }) => !instant)) return null;

  return {
    text: match[0],
    dateText,
    replacements: replacements.map(({ start, end, instant, format }) => ({
      start,
      end,
      element: { type: 'date', timestamp: instant.toUnixInteger(), format, fallback: `${instant.toFormat('yyyy-MM-dd HH:mm')} ${zone}` },
    })),
  };
}

// Returns [startMinutes, endMinutes] after midnight (startMinutes is undefined for a
// single time), or null when a clock is invalid or the range is ambiguous.
function clockMinutes(startText, endText) {
  const end = parseClock(endText);
  const endMinutes = minutesOfDay(end);
  if (endMinutes === null) return null;
  if (startText === undefined) return [undefined, endMinutes];

  const start = parseClock(startText);
  let startMinutes;
  if (start.meridiem || !end.meridiem) {
    // "3 PM-16:00" mixes clock styles; "15:00-16:00" and "3 PM-4 PM" do not.
    if (Boolean(start.meridiem) !== Boolean(end.meridiem)) return null;
    startMinutes = minutesOfDay(start);
  } else {
    // "3-4 PM" borrows PM. "11-1 PM" must start in the other half of the day.
    startMinutes = minutesOfDay({ ...start, meridiem: end.meridiem });
    if (startMinutes !== null && startMinutes > endMinutes) {
      startMinutes = minutesOfDay({ ...start, meridiem: end.meridiem === 'PM' ? 'AM' : 'PM' });
    }
  }
  if (startMinutes === null || startMinutes === endMinutes) return null;
  return [startMinutes, endMinutes];
}

function parseClock(clockText) {
  const [, hourText, minuteText, meridiem] = clockText.match(CLOCK_PARTS);
  return { hour: Number(hourText), minute: Number(minuteText ?? 0), hasMinutes: minuteText !== undefined, meridiem: meridiem?.toUpperCase() };
}

function minutesOfDay({ hour, minute, hasMinutes, meridiem }) {
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    return ((hour % 12) + (meridiem === 'PM' ? 12 : 0)) * 60 + minute;
  }
  // Without AM/PM, only a 24-hour clock time with minutes is unambiguous.
  if (!hasMinutes || hour > 23) return null;
  return hour * 60 + minute;
}

// Returns the instant in the sender's zone, or null when the time is invalid or ambiguous.
function resolveInstant(date, minutes, zone) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const instant = DateTime.fromObject({ year: date.year, month: date.month, day: date.day, hour, minute }, { zone });
  // Luxon shifts a time in a DST gap, and a time in a DST overlap has two offsets. Skip both.
  if (!instant.isValid || instant.hour !== hour || instant.minute !== minute) return null;
  if (instant.getPossibleOffsets().length !== 1) return null;
  return instant;
}

// Returns a copy of the blocks with each expression's clocks replaced by date elements,
// or null unless the plain-text elements contain exactly those expressions, in order.
// Code and quotes are left alone.
function replaceInBlocks(blocks, expressions) {
  const copy = structuredClone(blocks);
  let next = 0;
  let mismatch = false;

  const visit = node => {
    if (node.type === 'rich_text_list') {
      node.elements.forEach(visit);
      return;
    }
    if (node.type !== 'rich_text_section') return;
    node.elements = node.elements.flatMap(element => {
      if (element.type !== 'text' || element.style?.code) return [element];
      const pieces = [];
      let cursor = 0;
      const addText = end => {
        if (end > cursor) pieces.push({ ...element, text: element.text.slice(cursor, end) });
      };
      for (const match of element.text.matchAll(TIME_EXPRESSION)) {
        const expression = expressions[next++];
        if (expression?.text !== match[0]) {
          mismatch = true;
          return [element];
        }
        for (const { start, end, element: dateElement } of expression.replacements) {
          addText(match.index + start);
          pieces.push({ ...dateElement, ...(element.style ? { style: element.style } : {}) });
          cursor = match.index + end;
        }
      }
      addText(element.text.length);
      return pieces;
    });
  };

  for (const block of copy) {
    if (block.type === 'rich_text') block.elements.forEach(visit);
  }
  return !mismatch && next === expressions.length ? copy : null;
}
