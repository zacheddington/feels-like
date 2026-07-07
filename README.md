# Feels Like°

A weather app about the only number that matters: what it actually feels like
when you step outside.

The thermometer says 91° in both Jackson, Mississippi and Albuquerque, New
Mexico — but one of those is a porch afternoon and the other is a wet wool
blanket. Standard "feels like" numbers under-punish humid heat and ignore
direct sun entirely. This app computes its own index from dew point (not
relative humidity), measured solar radiation, wind, and damp cold — and shows
you the full ledger of adjustments so you can argue with it.

**Features**: search by city or US ZIP · favorites · side-by-side city
comparison · hourly feels-like curve · 7-day outlook · °F/°C · a color palette
that shifts with the weather itself.

## Run it

```
npx -y serve .
```

Any static file server works. No build step, no dependencies, no API keys —
weather data comes from [Open-Meteo](https://open-meteo.com/) straight from
the browser.

Try `/?mock=dry-heat,humid-heat` to see the whole point of the app without
waiting for the right weather.

## Deploy

Push to GitHub → Settings → Pages → deploy from `main`/root. Done.

Working on the code? Read `CLAUDE.md` first.
