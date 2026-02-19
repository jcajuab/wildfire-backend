import { describe, expect, test } from "bun:test";
import {
  isValidDaysOfWeek,
  isValidTime,
  isWithinTimeWindow,
  selectActiveSchedule,
} from "#/domain/schedules/schedule";

describe("schedule helpers", () => {
  test("validates time format", () => {
    expect(isValidTime("08:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("8:00")).toBe(false);
  });

  test("validates days of week", () => {
    expect(isValidDaysOfWeek([0, 1, 2])).toBe(true);
    expect(isValidDaysOfWeek([])).toBe(false);
    expect(isValidDaysOfWeek([7])).toBe(false);
  });

  test("checks time window including overnight", () => {
    expect(isWithinTimeWindow("09:00", "08:00", "17:00")).toBe(true);
    expect(isWithinTimeWindow("18:00", "08:00", "17:00")).toBe(false);
    expect(isWithinTimeWindow("01:00", "22:00", "02:00")).toBe(true);
  });

  test("selects schedule using configured timezone for both day and time", () => {
    const monday = 1;
    const mondayMorningUtc = new Date("2025-01-06T09:30:00.000Z");
    const schedules = [
      {
        id: "manila-evening",
        isActive: true,
        daysOfWeek: [monday],
        startTime: "17:00",
        endTime: "18:00",
        priority: 10,
      },
      {
        id: "utc-morning",
        isActive: true,
        daysOfWeek: [monday],
        startTime: "09:00",
        endTime: "10:00",
        priority: 5,
      },
    ];

    const result = (
      selectActiveSchedule as unknown as (
        input: typeof schedules,
        at: Date,
        timeZone: string,
      ) => (typeof schedules)[number] | null
    )(schedules, mondayMorningUtc, "Asia/Manila");

    expect(result?.id).toBe("manila-evening");
  });

  test("uses configured timezone date for schedule date windows", () => {
    const schedules = [
      {
        id: "should-match-local-date",
        isActive: true,
        startDate: "2025-01-01",
        endDate: "2025-01-01",
        daysOfWeek: [3],
        startTime: "00:00",
        endTime: "23:59",
        priority: 10,
      },
      {
        id: "utc-date-only",
        isActive: true,
        startDate: "2024-12-31",
        endDate: "2024-12-31",
        daysOfWeek: [3],
        startTime: "00:00",
        endTime: "23:59",
        priority: 5,
      },
    ];

    const utcMidnightBoundary = new Date("2024-12-31T16:30:00.000Z");
    const result = (
      selectActiveSchedule as unknown as (
        input: typeof schedules,
        at: Date,
        timeZone: string,
      ) => (typeof schedules)[number] | null
    )(schedules, utcMidnightBoundary, "Asia/Manila");

    expect(result?.id).toBe("should-match-local-date");
  });
});
