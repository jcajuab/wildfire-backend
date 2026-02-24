const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const isValidTime = (value: string) => timeRegex.test(value);

export const isValidDate = (value: string) => isoDateRegex.test(value);

const toMinutes = (value: string) => {
  const match = timeRegex.exec(value);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
};

const toZonedTimeString = (now: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (!hour || !minute) {
    throw new Error(`Unable to resolve zoned time parts for ${timeZone}`);
  }

  return `${hour}:${minute}`;
};

const toZonedDateString = (now: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Unable to resolve zoned date parts for ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
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
    startTime: string;
    endTime: string;
    priority: number;
  },
>(
  schedules: T[],
  now: Date,
  timeZone = "UTC",
) => {
  const time = toZonedTimeString(now, timeZone);
  const date = toZonedDateString(now, timeZone);

  return (
    schedules
      .filter((schedule) => schedule.isActive)
      .filter((schedule) => {
        if (!schedule.startDate || !schedule.endDate) {
          return true;
        }
        return isWithinDateWindow(date, schedule.startDate, schedule.endDate);
      })
      .filter((schedule) =>
        isWithinTimeWindow(time, schedule.startTime, schedule.endTime),
      )
      .sort((a, b) => b.priority - a.priority)[0] ?? null
  );
};
