// Month grids for the calendars. The week starts on the day the company chose in its settings.
const WEEK_START_INDEX = { sunday: 0, monday: 1, saturday: 6 };
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayHeaders(weekStart) {
  const start = WEEK_START_INDEX[weekStart] ?? 1;
  return DAY_NAMES.map((_, i) => DAY_NAMES[(start + i) % 7]);
}

export function buildMonthCells(year, month, weekStart) {
  const first = new Date(year, month, 1);
  const daysIn = new Date(year, month + 1, 0).getDate();
  const pad = (first.getDay() - (WEEK_START_INDEX[weekStart] ?? 1) + 7) % 7;
  const cells = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
