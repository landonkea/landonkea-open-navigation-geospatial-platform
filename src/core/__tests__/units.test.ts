import { describe, it, expect } from "vitest";
import { formatDistance, formatSpeed, formatTemperatureC } from "../units";

describe("formatDistance", () => {
  it("shows feet for short imperial distances", () => {
    expect(formatDistance(50, "imperial")).toBe("164 ft");
  });
  it("shows miles for longer imperial distances", () => {
    expect(formatDistance(1609.344 * 3, "imperial")).toBe("3.0 mi");
  });
  it("shows meters for short metric distances", () => {
    expect(formatDistance(50, "metric")).toBe("50 m");
  });
  it("shows km for longer metric distances", () => {
    expect(formatDistance(5000, "metric")).toBe("5.0 km");
  });
});

describe("formatSpeed", () => {
  it("converts m/s to mph", () => {
    expect(formatSpeed(4.4704, "imperial")).toBe("10.0 mph");
  });
  it("converts m/s to km/h", () => {
    expect(formatSpeed(10, "metric")).toBe("36.0 km/h");
  });
});

describe("formatTemperatureC", () => {
  it("converts to Fahrenheit", () => {
    expect(formatTemperatureC(0, "imperial")).toBe("32°F");
    expect(formatTemperatureC(100, "imperial")).toBe("212°F");
  });
  it("passes through Celsius", () => {
    expect(formatTemperatureC(22.4, "metric")).toBe("22°C");
  });
});
