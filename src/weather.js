// OpenTower - live weather from the US National Weather Service (CORS enabled).
// Falls back to simulated weather when offline or blocked.

const STATION = 'KPHX';

export async function fetchWeather({ timeoutMs = 4000 } = {}) {
  if (typeof fetch !== 'function') return null;
  const canAbort = typeof AbortController !== 'undefined';
  const ctrl = canAbort ? new AbortController() : null;
  const timer = canAbort ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const options = { headers: { Accept: 'application/geo+json' } };
    if (ctrl) options.signal = ctrl.signal;
    const res = await fetch(`https://api.weather.gov/stations/${STATION}/observations/latest`, options);
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const body = await res.json();
    const p = body.properties || {};
    const windDir = num(p.windDirection);
    const windKt = Math.round(kmhToKt(num(p.windSpeed)));
    const gustKt = Math.round(kmhToKt(num(p.windGust)));
    const pressurePa = num(p.barometricPressure);
    const visibilityM = num(p.visibility);
    const obs = {
      live: true,
      station: STATION,
      observedAt: p.timestamp || null,
      windDir: windDir ?? 0,
      windSpeed: Number.isFinite(windKt) ? windKt : 0,
      windGust: Number.isFinite(gustKt) ? gustKt : 0,
      altimeter: Number.isFinite(pressurePa) ? (pressurePa / 3386.389).toFixed(2) : '29.92',
      visibilitySm: Number.isFinite(visibilityM) ? Math.round(visibilityM / 1609.34) : 10,
      tempC: num(p.temperature),
      dewC: num(p.dewpoint),
      description: p.textDescription || '',
    };
    obs.raw = `${obs.station} ${stamp(p.timestamp)} ${pad3(obs.windDir)}${pad2(obs.windSpeed)}${obs.windGust ? `G${pad2(obs.windGust)}` : ''}KT ${pad2(obs.visibilitySm)}SM ${Math.round(obs.tempC ?? 0)}/${Math.round(obs.dewC ?? 0)} A${obs.altimeter}`;
    return obs;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function num(v) {
  const n = v && typeof v === 'object' ? v.value : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const kmhToKt = (v) => (v == null ? 0 : v * 0.539957);
const pad2 = (n) => String(Math.max(0, Math.round(n))).padStart(2, '0');
const pad3 = (n) => String(Math.max(0, Math.round(n))).padStart(3, '0');

function stamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z`;
}

/** Active runway 09 or 27 from the wind direction (the runway you land into). */
export function runwayForWind(dir) {
  if (dir == null || Number.isNaN(dir)) return Math.random() < 0.5 ? '27' : '09';
  const angle = (a, b) => {
    const d = Math.abs(((a - b + 540) % 360) - 180);
    return d;
  };
  return angle(dir, 90) <= angle(dir, 270) ? '09' : '27';
}
