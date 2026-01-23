import dayjs from 'dayjs';
/*
// Function to calculate the difference in the specified unit
function dateDiffInUnits(date1, date2) {
  const msPerSecond = 1000;
  const msPerMinute = msPerSecond * 60;
  const msPerHour = msPerMinute * 60;
  const msPerDay = msPerHour * 24;
  const msPerMonth = msPerDay * 30; // Approximation
  const msPerYear = msPerDay * 365; // Approximation

  const diffInMs = date2 - date1;
  
  return {
    years: diffInMs / msPerYear,
    months: diffInMs / msPerMonth,
    days: diffInMs / msPerDay,
    hours: diffInMs / msPerHour,
    minutes: diffInMs / msPerMinute,
    seconds: diffInMs / msPerSecond,
  };
}

// Function to determine the best unit based on the differences
function chooseBestUnit(diffs) {
  if (Math.abs(diffs.years) >= 1) return 'year';
  if (Math.abs(diffs.months) >= 1) return 'month';
  if (Math.abs(diffs.days) >= 1) return 'day';
  if (Math.abs(diffs.hours) >= 1) return 'hour';
  if (Math.abs(diffs.minutes) >= 1) return 'minute';
  return 'second';
}

// Function to format the relative time between two dates
function formatRelativeTime(date1, date2, locale = 'en') {
  const diffs = dateDiffInUnits(date1, date2);
  const bestUnit = chooseBestUnit(diffs);
  const diff = diffs[bestUnit];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  return rtf.format(Math.round(diff), bestUnit);
}

// Example dates
const date1 = new Date('2023-07-01');
const date2 = new Date('2024-07-13');

// Format the relative time automatically choosing the best unit
console.log(formatRelativeTime(date1, date2)); // Output: "in 1 year"

*/

export type TDateInfo = {
    isPast: boolean,
    delta: number,
    text: string
}

export const timeSince = (date: Date | number | string): TDateInfo | null => {

    if (date === undefined)
        return null;

    // Timeago ne prend que des dates et des timestamp
    if (typeof date === 'string') {
        date = Date.parse(date);
        if (isNaN(date))
            return null;
    }

    // Get metas
    const now = Date.now()
    const timestamp = date instanceof Date ? date.getTime() : date;
    const deltaSeconds = Math.abs( Math.round( (now - timestamp) / 1000 ));
    const isPast = now > timestamp;

    return {
        text: date,//timeAgo.format(date),
        isPast,
        delta: deltaSeconds
    };
}

export const tempsRelatif = (time: number, nbChiffresInit?: number) => {

    const nbChiffres = nbChiffresInit === undefined ? 2 : nbChiffresInit;

    const jours = Math.floor(time / (60 * 60 * 24));

    if (jours >= 1) {

        return jours + (jours === 1 ? ' day' : ' days')

    } else {

        const heures = Math.floor((time % (60 * 60 * 24)) / (60 * 60));
        const minutes = Math.floor((time % (60 * 60)) / (60));
        const secondes = Math.floor(time % (60));

        return [heures, minutes, secondes].filter(
            (nb: number | false, i: number) => nb > 0 || 4 - i <= nbChiffres
        ).map(
            (nb: number) => nb < 10 ? '0' + nb : nb
        ).join(':');
    }
}

export const chaineDate = (chaine: string): boolean => {
    // 2019-09-09T11:28:21.778Z
    const regexDate = /[0-9]{4}\-[0-9]{2}\-[0-9]{2}T[0-9]{2}\:[0-9]{2}\:[0-9]{2}\.[0-9]{3}Z/;
    return regexDate.test( chaine );
}





// Based on https://github.com/sebastiansandqvist/s-ago/blob/master/index.ts
type TUnit = {
    max: number,
    divisor?: number,
    past: string,
    future: string
}

const units: {[name: string]: TUnit} = {
    seconds: { max: 60000, past: 'just now', future: 'now' },
    minute: { max: 2760000, divisor: 60000, past: 'a minute ago', future: 'in a minute' }, // max: 46 minutes
    hour: { max: 72000000, divisor: 3600000, past: 'an hour ago', future: 'in an hour' }, // max: 20 hours
    day: { max: 518400000, divisor: 86400000, past: 'yesterday', future: 'tomorrow' }, // max: 6 days
    week: { max: 2419200000, divisor: 604800000, past: 'last week', future: 'in a week' }, // max: 28 days
    month: { max: 28512000000, divisor: 2592000000, past: 'last month', future: 'in a month' }, // max: 11 months
    year: { max: Infinity, divisor: 31536000000, past: 'last year', future: 'in a year' },
};

export function ago(date: Date | string, { min, max }: { min?: string, max?: string } = {}): string {

    if (!date)
        return '-';

    if (typeof date === 'string')
        date = new Date(date);

    const minUnit = min ? units[min].max : 0;
    const diff = Date.now() - date.getTime();
    const delta = Math.abs(diff);

    let unitName!: string;
    let unit!: TUnit;
    for (unitName in units) {
        unit = units[unitName];
        if (unit.max >= minUnit && (delta < unit.max || unitName === max))
            break;
    }

    if (unit.divisor === undefined)
        return diff < 0 ? unit.future : unit.past;

    var val = Math.round(delta / unit.divisor);
    if (diff < 0) 
        return val <= 1 ? unit.future : 'in ' + val + ' ' + unitName + 's';
    else
        return val <= 1 ? unit.past : val + ' ' + unitName + 's ago';

};

export const daysAgo = (date: string) => {

    const days = dayjs().diff(date, 'days')

    if (days === 0)
        return 'Today';
    else if (days === 1)
        return 'Yesterday';
    else if (days <= 7)
        return days + ' days ago'
    else 
        return dayjs(date).format('DD/MM');

}