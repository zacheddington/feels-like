// mock.js — synthetic weather for testing without a network connection.
//
// Open the app with ?mock=<scenario> to see a scenario, e.g. ./?mock=humid-heat
// Compare two with a comma:  ./?mock=dry-heat,humid-heat
// Force night theming with:  ./?mock=warm&night
// Scenario names double as theme moods, so this is also how you preview palettes.

export const SCENARIOS = {
  'dry-heat':   { place: 'Alkali Flats, NM',   hi: 97, lo: 66, dp: 28, wind: 9,  cloud: 5,   code: 0 },
  'humid-heat': { place: 'Steamwood, MS',      hi: 94, lo: 76, dp: 75, wind: 6,  cloud: 35,  code: 1 },
  'warm':       { place: 'Fair Weather, CA',   hi: 79, lo: 59, dp: 52, wind: 7,  cloud: 15,  code: 1 },
  'mild':       { place: 'Graysmere, OR',      hi: 63, lo: 49, dp: 47, wind: 9,  cloud: 70,  code: 3 },
  'chill':      { place: 'Dampford, WA',       hi: 46, lo: 37, dp: 42, wind: 13, cloud: 100, code: 61 },
  'cold':       { place: 'Frostbite Falls, MN', hi: 26, lo: 9, dp: 10, wind: 16, cloud: 45,  code: 73 },
};

// Relative humidity from temperature + dew point (Magnus approximation).
function rhFrom(tempF, dpF) {
  const tc = (tempF - 32) * 5 / 9;
  const dc = (dpF - 32) * 5 / 9;
  const g = (t) => (17.62 * t) / (243.12 + t);
  return Math.min(100, Math.round(100 * Math.exp(g(dc) - g(tc))));
}

const pad = (n) => String(n).padStart(2, '0');

export function mockWeather(name, forceNight) {
  const s = SCENARIOS[name] || SCENARIOS.mild;
  const hourly = {
    time: [], temperature_2m: [], relative_humidity_2m: [], dew_point_2m: [],
    wind_speed_10m: [], cloud_cover: [], shortwave_radiation: [],
    precipitation_probability: [], weather_code: [], is_day: [],
  };
  const daily = { time: [], weather_code: [] };
  const codeCycle = [s.code, s.code, 3, s.code, 2, s.code, 1];

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let d = 0; d < 7; d++) {
    const day = new Date(start.getTime() + d * 86400000);
    const dateStr = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    daily.time.push(dateStr);
    daily.weather_code.push(codeCycle[d]);
    for (let h = 0; h < 24; h++) {
      // Diurnal curve: coldest ~4am, hottest ~4pm
      const frac = 0.5 * (1 - Math.cos((2 * Math.PI * (h - 4)) / 24));
      const temp = s.lo + (s.hi - s.lo) * frac;
      const isDay = h >= 6 && h < 20 ? 1 : 0;
      const sunArc = isDay ? Math.pow(Math.sin((Math.PI * (h - 6)) / 14), 1.3) : 0;
      hourly.time.push(`${dateStr}T${pad(h)}:00`);
      hourly.temperature_2m.push(Math.round(temp * 10) / 10);
      hourly.dew_point_2m.push(s.dp);
      hourly.relative_humidity_2m.push(rhFrom(temp, s.dp));
      hourly.wind_speed_10m.push(s.wind);
      hourly.cloud_cover.push(s.cloud);
      hourly.shortwave_radiation.push(Math.round(sunArc * 950 * (1 - 0.75 * s.cloud / 100)));
      hourly.precipitation_probability.push(s.code >= 51 ? 70 : 5);
      hourly.weather_code.push(codeCycle[d]);
      hourly.is_day.push(isDay);
    }
  }

  // Mock "now" is pinned to 3pm (or 10pm with ?night) so every scenario looks
  // the same no matter when you test it — the scenario name matches the mood.
  const nowHour = forceNight ? 22 : 15;
  const nowIndex = nowHour; // first mock day starts at midnight today
  const current = {
    time: hourly.time[nowIndex],
    temperature_2m: hourly.temperature_2m[nowIndex],
    relative_humidity_2m: hourly.relative_humidity_2m[nowIndex],
    dew_point_2m: hourly.dew_point_2m[nowIndex],
    wind_speed_10m: hourly.wind_speed_10m[nowIndex],
    cloud_cover: hourly.cloud_cover[nowIndex],
    shortwave_radiation: hourly.shortwave_radiation[nowIndex],
    weather_code: hourly.weather_code[nowIndex],
    is_day: forceNight ? 0 : hourly.is_day[nowIndex],
    precipitation: 0,
  };

  return { current, hourly, daily, nowIndex, mock: true };
}
