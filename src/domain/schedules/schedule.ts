const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const isValidTime = (value: string) => timeRegex.test(value);

export const isValidDaysOfWeek = (value: number[]) =>
  value.length > 0 &&
  value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);

export const isValidDate = (value: string) => isoDateRegex.test(value);

const toMinutes = (value: string) => {
  const match = timeRegex.exec(value);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
};

const weekdayToNumber: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const toZonedDayAndTime = (now: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (!weekday || !hour || !minute) {
    throw new Error(`Unable to resolve zoned date parts for ${timeZone}`);
  }

  const day = weekdayToNumber[weekday];
  if (day === undefined) {
    throw new Error(`Unsupported weekday value: ${weekday}`);
  }

  return { day, time: `${hour}:${minute}` };
};

export const isWithinTimeWindow = (
  current: string,
  start: string,
  end: string,
) => {
  if (!isValidTime(current) || !isValidTime(start) || !isValidTime(end)) {
    return false;
  }

  const currentMinutes = toMinutes(current);
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);

  if (startMinutes === endMinutes) {
    return false;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
};

const getUtcDateString = (date: Date) => date.toISOString().slice(0, 10);

export const isWithinDateWindow = (
  current: string,
  start: string,
  end: string,
) => {
  if (!isValidDate(current) || !isValidDate(start) || !isValidDate(end)) {
    return false;
  }
  return current >= start && current <= end;
};

export const selectActiveSchedule = <
  T extends {
    isActive: boolean;
    startDate?: string;
    endDate?: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    priority: number;
  },
>(
  schedules: T[],
  now: Date,
  timeZone = "UTC",
) => {
  const { day, time } = toZonedDayAndTime(now, timeZone);
  const date = getUtcDateString(now);

  return (
    schedules
      .filter((schedule) => schedule.isActive)
      .filter((schedule) => {
        if (!schedule.startDate || !schedule.endDate) {
          return true;
        }
        return isWithinDateWindow(date, schedule.startDate, schedule.endDate);
      })
      .filter((schedule) => schedule.daysOfWeek.includes(day))
      .filter((schedule) =>
        isWithinTimeWindow(time, schedule.startTime, schedule.endTime),
      )
      .sort((a, b) => b.priority - a.priority)[0] ?? null
  );
};
