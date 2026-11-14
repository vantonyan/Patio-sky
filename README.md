# Patio Sky

Offline night-sky guide for an Android tablet. It shows which of the 88 constellations are up from Sylmar (or wherever the tablet is), lists Messier and bright NGC/IC objects with altitude and azimuth, and keeps a capture log on the device. There is no account and no server.

The screen is red on black, with large tap targets, so it can be used at a dark site without wrecking night vision.

## Run it locally

```bash
npm install
npm test
npm run build
npm run preview
```

Open http://127.0.0.1:4317 . The production build in `dist/` is what you host. The service worker caches the app shell, catalogs, and icons, so after one online load it keeps working with the network off.

`npm run dev` starts the same port with hot reload. Use the preview server to check offline behavior. Service workers only control http://localhost or HTTPS.

## Install on an Android tablet

The page has to be served over HTTPS (localhost is the only exception). After it is deployed:

1. Open the site in Chrome on the tablet.
2. Wait until the sky chart and the Messier count appear, so the catalogs are cached.
3. Tap the Chrome menu (three dots) and choose **Add to Home screen** or **Install app**.
4. Open **Patio Sky** from the home screen. It runs full screen.
5. Turn on airplane mode and open it again. The chart, catalogs, and log should still be there. GPS will not update offline; the last saved place, or the Sylmar preset, is used.

If Chrome does not offer install, reload once while online. The manifest and service worker are registered on that first visit.

## Host it for free on HTTPS

The build is a static `dist/` folder. Any of these work.

**Cloudflare Pages**

1. Push this project to a Git host Cloudflare can read, or use the direct-upload option.
2. Build command: `npm run build`. Output directory: `dist`.
3. Deploy. You get an `https://….pages.dev` address. Open that on the tablet.

**Netlify**

1. New site from Git, or drag the `dist/` folder onto the Netlify drop page.
2. Build command `npm run build`, publish directory `dist`.
3. Use the `https://….netlify.app` URL.

**GitHub Pages**

For a user site (`https://username.github.io/`) the default base path `/` is correct. For a project site (`https://username.github.io/repo/`) rebuild with the repo name:

```bash
VITE_BASE=/repo/ npm run build
```

Publish the `dist/` directory (GitHub Actions `actions/upload-pages-artifact`, or push `dist/` to the `gh-pages` branch). The app uses hash routes (`#sky`, `#tonight`), so the host does not need URL rewrites.

## What the tablet does

- **Sky.** Polar chart, zenith in the center, north up. Stick figures for all 88 IAU constellations, optional boundary lines, altitude and azimuth of each figure’s center, and whether it is up, partly up, or down. Tap a name for its objects. Captured ones are checked. Missing ones are highlighted.
- **Tonight.** Uncaptured Messier and NGC/IC objects that clear the horizon right now. Sort by altitude, brightness, or size. Filter by type, magnitude limit, and minimum altitude.
- **Catalog.** All 110 Messier objects plus the bright/extended OpenNGC subset. Each object has type, magnitude, size, J2000 RA/Dec, constellation, current alt/az, and, on its page, rise, transit, and set.
- **Log.** Mark an object captured or observed, with date, scope, and notes. Stored in IndexedDB, with a localStorage copy. Export and import JSON or CSV. Importing the Messier spreadsheet (xlsx or CSV) marks the names it finds.
- **Setup.** Sylmar home (34.3 N, 118.45 W), device GPS, or a typed latitude and longitude. Time slider from −12 h to +18 h, or a date and time. Home patio horizon, or a flat horizon that defaults to 15°.

An object is above the patio horizon only when its altitude is greater than the interpolated horizon altitude at that azimuth **plus 2°**. Azimuth 20–60° at home is flagged **poor: streetlights/tree gap**. Away from home the flat horizon is used. GPS within about 8 km of Sylmar is treated as home.

Positions are J2000 catalog coordinates, precessed to the date, then converted with Greenwich apparent sidereal time and normal atmospheric refraction. `npm test` checks that against `astronomy-engine` for M42 from Sylmar at 2026-11-15 00:00 Pacific (08:00 UTC): about **+42.3° altitude, azimuth 141°**. A star on the meridian at declination −20° from latitude 34.3° culminates near **+35.7° due south**.

## Refresh the Messier seed from the spreadsheet

The capture log is seeded at build time from the spreadsheet, then stored on the device. This repo already includes that seed: 72 of 110 Messier objects, read from even-numbered columns of `data/source/Messier_objects.xlsx`, and the Foothill patio profile in `data/source/Foothill_horizon.hrz`. Re-running the seed does not erase a log that is already on the tablet. Use **Log → Import** for that, or **Restore spreadsheet seed** to merge.

1. Put the workbook at `data/source/Messier_objects.xlsx` (CSV is fine too).
2. Run `python3 scripts/prepare_data.py`.
3. Run `npm run build` and redeploy `dist/`.

The script reads **even-numbered columns** (Excel B, D, F, …). Each cell is stripped of spaces and trailing tabs, so `M80` and `M80\t` both count. Names must look like `M42` or `M 42`. If that reading is not 72 objects and the other column parity is, the parity that yields 72 is kept, and the script prints which rule it used. The result is `public/data/messier-seed.json`.

You can also skip the rebuild: in the app, **Log → Import** and choose the xlsx or a CSV saved from it. Leave “Replace the whole log” off to merge. Turn it on to make the log match the sheet exactly.

The same script picks up a replacement patio profile from `data/source/Foothill_horizon.hrz`. Lines are azimuth then altitude in degrees. `#` comments and a text header are ignored. Output is `public/data/horizon.json`.

## Data and licenses

| Data | Source | License |
| --- | --- | --- |
| Constellation figures and names | [d3-celestial](https://github.com/ofrohn/d3-celestial) (Olaf Frohn), from the IAU figures | BSD-3-Clause |
| Constellation boundaries | Davenhall & Leggett 1989, VizieR VI/49, via d3-celestial | Catalog VI/49, packaged under the d3-celestial BSD terms |
| NGC/IC and Messier positions | [OpenNGC](https://github.com/mattiaverga/OpenNGC) (Mattia Verga) | CC-BY-SA-4.0. `public/data/catalog.json` is a filtered derivative |
| Alt/az, precession, refraction | [astronomy-engine](https://github.com/cosinekitty/astronomy) | MIT |

The catalog keeps every Messier object. Other NGC/IC rows are included when V magnitude (or B, if V is blank) is 13.0 or brighter, or when magnitude is missing and the major axis is at least 2 arcminutes. Stars, duplicate rows, and nonexistent entries are left out. OpenNGC marks M102 as a repeat of M101; this app uses the usual imaging identification, NGC 5866, the Spindle Galaxy in Draco. See `public/data/NOTICE.txt`.

## Tests

```bash
npm test
```

Vitest checks the alt/az formula against astronomy-engine, rise/set against the horizon altitude, horizon interpolation (including the wrap past north and the +2° rule), the spreadsheet column parser (including trailing tabs), and that the bundled catalogs contain 88 constellations and 110 Messier objects in the expected constellations.
