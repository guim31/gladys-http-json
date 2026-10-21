// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `values`.
//
// The use case: a glance at every value read over HTTP (a router, a NAS, an
// API of the town) without adding a device tile per sensor. One row per
// sensor — the value with its unit, or "Error" — for every sensor, or the
// ones chosen in the widget settings (their devices). The values are sent as
// values, not bound to features: the widget works before any device is added.
//
// Budget (8 components, 2 texts): one text when nothing is configured, one
// status list of ten rows at most, and a Refresh button.
// (Adapted from guim31/gladys-influxdb.)
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_UNITS as UNIT, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { parseSlotId, sensorName } from './devices.js';
import { HttpHub, WIDGET_KEY } from './hub.js';
import { SENSOR_TYPES } from './sensors.js';
import { pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of a sensor in the configuration of the integration.',
    fr: "Saisissez l'adresse d'un capteur dans la configuration de l'intégration.",
    de: 'Gib die Adresse eines Sensors in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de un sensor en la configuración de la integración.',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  noData: { en: 'No data', fr: 'Aucune donnée', de: 'Keine Daten', es: 'Sin datos' },
  on: { en: 'On', fr: 'Oui', de: 'An', es: 'Sí' },
  off: { en: 'Off', fr: 'Non', de: 'Aus', es: 'No' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Sensors read again.',
    fr: 'Capteurs relus.',
    de: 'Sensoren neu gelesen.',
    es: 'Sensores leídos de nuevo.',
  },
};

const UNIT_SYMBOLS = {
  [UNIT.CELSIUS]: ' °C',
  [UNIT.PERCENT]: ' %',
  [UNIT.WATT]: ' W',
  [UNIT.KILOWATT_HOUR]: ' kWh',
};

const ICONS = {
  number: 'activity',
  temperature: 'thermometer',
  humidity: 'droplet',
  percent: 'percent',
  power: 'zap',
  energy: 'battery-charging',
  binary: 'toggle-right',
  text: 'type',
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A value as shown: "21,5 °C", "On", a text. */
export function formatValue(sensor, value, language) {
  if (sensor.type === 'binary') {
    return pick(value ? TEXT.on : TEXT.off, language);
  }
  const text = HttpHub.valueText(sensor, value, language);
  return typeof value === 'number'
    ? `${text}${UNIT_SYMBOLS[SENSOR_TYPES[sensor.type].unit] ?? ''}`
    : text;
}

/** The sensors the widget shows: the chosen devices, or every sensor. */
export function chosenSensors(hub, settings) {
  const chosen = [settings?.sensors ?? []].flat().filter((id) => typeof id === 'string' && id);
  const all = [...hub.sensors.values()];
  if (chosen.length === 0) {
    return all;
  }
  // A chosen device whose slot was emptied shows nothing, not every sensor.
  const slots = new Set(chosen.map((id) => parseSlotId(hub.gladys, id)));
  return all.filter((sensor) => slots.has(sensor.slot));
}

function row(hub, sensor, language) {
  const reading = hub.readings.get(sensor.slot);
  const label = fit(sensorName(sensor, language), 40);
  if (reading?.failing) {
    return {
      label,
      value: pick(TEXT.error, language),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (reading?.value === null || reading?.value === undefined) {
    return {
      label,
      value: pick(TEXT.noData, language),
      icon: 'minus-circle',
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label,
    value: fit(formatValue(sensor, reading.value, language), 40),
    icon: ICONS[sensor.type],
    color: WIDGET_COLORS.INFO,
  };
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.sensors.size === 0) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.configure, language) }],
    };
  }
  const sensors = chosenSensors(hub, settings).slice(0, MAX_ROWS);
  const components = [];
  if (sensors.length > 0) {
    components.push({ type: 'status', items: sensors.map((sensor) => row(hub, sensor, language)) });
  }
  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });
  const shortest = Math.min(...sensors.map((sensor) => sensor.intervalMs), 300_000);
  return { ttl_seconds: Math.max(30, Math.round(shortest / 1000)), components };
}

async function action(hub, { actionKey, settings }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const slots = chosenSensors(hub, settings).map((sensor) => sensor.slot);
  await hub.readDue({ slots });
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
