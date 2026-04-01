const DAILY_LIMIT = 100000;
const TARGET_DAILY_REQUESTS = Math.round(DAILY_LIMIT * 0.8);
const JOURNEYS = [
  {
    name: "Public funnel",
    description: "index -> p -> checkout -> create_order",
    weight: 0.45,
    before: 7,
    after: 4
  },
  {
    name: "Partner checkout funnel",
    description: "dashboard -> checkout -> create_order",
    weight: 0.2,
    before: 4,
    after: 3
  },
  {
    name: "Member auth funnel",
    description: "login -> dashboard -> akses",
    weight: 0.25,
    before: 4,
    after: 2
  },
  {
    name: "Admin observability",
    description: "admin-area -> metrics dashboard",
    weight: 0.1,
    before: 3,
    after: 2
  }
];

const HOURLY_SHAPE = [
  0.012, 0.01, 0.009, 0.009, 0.011, 0.018,
  0.028, 0.04, 0.052, 0.061, 0.07, 0.074,
  0.072, 0.067, 0.063, 0.061, 0.064, 0.07,
  0.073, 0.061, 0.05, 0.037, 0.025, 0.021
];

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function weightedAverage(field) {
  return JOURNEYS.reduce((sum, journey) => sum + (journey.weight * journey[field]), 0);
}

function makeHourlySeries(total) {
  let distributed = HOURLY_SHAPE.map((ratio) => Math.round(ratio * total));
  const currentTotal = distributed.reduce((sum, value) => sum + value, 0);
  const delta = total - currentTotal;
  if (delta !== 0) distributed[12] += delta;
  return distributed.map((count, hour) => ({
    hour: String(hour).padStart(2, "0") + ":00",
    count
  }));
}

function thresholdStatus(total) {
  return {
    warn80: total >= DAILY_LIMIT * 0.8,
    warn90: total >= DAILY_LIMIT * 0.9
  };
}

function cumulativeCrossHour(hourly, threshold) {
  let running = 0;
  for (const item of hourly) {
    running += item.count;
    if (running >= threshold) return item.hour;
  }
  return null;
}

function buildDaySummary(label, targetAfterRequests) {
  const avgBefore = weightedAverage("before");
  const avgAfter = weightedAverage("after");
  const journeyUnits = targetAfterRequests / avgAfter;
  const beforeRequests = Math.round(journeyUnits * avgBefore);
  const afterRequests = Math.round(journeyUnits * avgAfter);
  const beforeHourly = makeHourlySeries(beforeRequests);
  const afterHourly = makeHourlySeries(afterRequests);
  const beforePeak = beforeHourly.reduce((max, item) => item.count > max.count ? item : max, beforeHourly[0]);
  const afterPeak = afterHourly.reduce((max, item) => item.count > max.count ? item : max, afterHourly[0]);

  return {
    label,
    beforeRequests,
    afterRequests,
    beforePercent: round((beforeRequests / DAILY_LIMIT) * 100),
    afterPercent: round((afterRequests / DAILY_LIMIT) * 100),
    beforePeak,
    afterPeak,
    beforeThresholds: thresholdStatus(beforeRequests),
    afterThresholds: thresholdStatus(afterRequests),
    beforeWarnHour: cumulativeCrossHour(beforeHourly, DAILY_LIMIT * 0.8),
    beforeCriticalHour: cumulativeCrossHour(beforeHourly, DAILY_LIMIT * 0.9),
    afterWarnHour: cumulativeCrossHour(afterHourly, DAILY_LIMIT * 0.8),
    afterCriticalHour: cumulativeCrossHour(afterHourly, DAILY_LIMIT * 0.9)
  };
}

function main() {
  const avgBefore = weightedAverage("before");
  const avgAfter = weightedAverage("after");
  const weightedReduction = round(((avgBefore - avgAfter) / avgBefore) * 100);
  const dailyJourneyUnits = round(TARGET_DAILY_REQUESTS / avgAfter, 2);
  const dayLabels = ["Day 1", "Day 2", "Day 3"];
  const days = dayLabels.map((label) => buildDaySummary(label, TARGET_DAILY_REQUESTS));

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({
      daily_limit: DAILY_LIMIT,
      target_daily_requests: TARGET_DAILY_REQUESTS,
      journeys: JOURNEYS,
      weighted_average_before: round(avgBefore, 2),
      weighted_average_after: round(avgAfter, 2),
      weighted_reduction_percent: weightedReduction,
      journey_units_per_day: dailyJourneyUnits,
      days
    }, null, 2));
    return;
  }

  console.log("Cloudflare Worker Budget Audit Simulation");
  console.log("=========================================");
  console.log("Daily limit:", DAILY_LIMIT.toLocaleString("en-US"));
  console.log("Target daily requests after optimization:", TARGET_DAILY_REQUESTS.toLocaleString("en-US"));
  console.log("Weighted average requests/journey before:", round(avgBefore, 2));
  console.log("Weighted average requests/journey after :", round(avgAfter, 2));
  console.log("Weighted request reduction             :", weightedReduction + "%");
  console.log("Journey units/day at 80% budget       :", dailyJourneyUnits);
  console.log("");
  console.log("Journey breakdown:");
  JOURNEYS.forEach((journey) => {
    const reduction = round(((journey.before - journey.after) / journey.before) * 100);
    console.log(
      "- " + journey.name +
      " | before=" + journey.before +
      " after=" + journey.after +
      " reduction=" + reduction + "%" +
      " | " + journey.description
    );
  });
  console.log("");
  days.forEach((day) => {
    console.log(day.label + ":");
    console.log("  Before:", day.beforeRequests.toLocaleString("en-US"), "(" + day.beforePercent + "%), peak", day.beforePeak.hour, "=", day.beforePeak.count.toLocaleString("en-US"), "| 80% @", day.beforeWarnHour || "-", "| 90% @", day.beforeCriticalHour || "-");
    console.log("  After :", day.afterRequests.toLocaleString("en-US"), "(" + day.afterPercent + "%), peak", day.afterPeak.hour, "=", day.afterPeak.count.toLocaleString("en-US"), "| 80% @", day.afterWarnHour || "-", "| 90% @", day.afterCriticalHour || "-");
  });
}

main();
