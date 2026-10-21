// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow): one device per configured slot, identity = the slot number, with
// two features:
//   - the value, of the type chosen for the slot (its key holds the type: a
//     new type is a new feature, never a temperature history read as power);
//   - "In error" (input/binary): 1 while the sensor fails.
//
// Published with should_poll: false: the integration reads on its own timer
// (src/hub.js), at the interval of each sensor (30 s to 1 h, beyond the fixed
// list of the core scheduler).
// -----------------------------------------------------------------------------

import { SENSOR_TYPES } from './sensors.js';
import { FEATURE_TEXT, pick } from './texts.js';

export const SENSOR_DEVICE = 'sensor';
export const MODEL = 'HTTP / JSON sensor';
export const ERROR_FEATURE = 'error';

export const sensorIds = (gladys, slot) => gladys.externalIds(SENSOR_DEVICE, String(slot));
export const valueFeatureKey = (type) => `value_${type}`;

/** The slot of a device external id, null when it is not one of ours. */
export function parseSlotId(gladys, externalId) {
  const prefix = sensorIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const slot = Number(externalId.slice(prefix.length));
  return Number.isInteger(slot) && slot > 0 ? slot : null;
}

/** The name of a sensor: the one typed, or "HTTP sensor 3". */
export const sensorName = (sensor, language) =>
  sensor.name || `${pick(FEATURE_TEXT.sensor, language)} ${sensor.slot}`;

const readOnly = { read_only: true, has_feedback: false };

/** The discovery payload of a sensor. */
export function buildSensorDevice(gladys, sensor, language) {
  const ids = sensorIds(gladys, sensor.slot);
  const spec = SENSOR_TYPES[sensor.type];
  const name = sensorName(sensor, language);
  return {
    name,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    features: [
      {
        name,
        external_id: ids.feature(valueFeatureKey(sensor.type)),
        category: spec.category,
        type: spec.type,
        ...(spec.unit ? { unit: spec.unit } : {}),
        ...readOnly,
        keep_history: sensor.type !== 'text',
        min: spec.min,
        max: spec.max,
      },
      {
        name: pick(FEATURE_TEXT.error, language),
        external_id: ids.feature(ERROR_FEATURE),
        category: SENSOR_TYPES.binary.category,
        type: SENSOR_TYPES.binary.type,
        ...readOnly,
        keep_history: true,
        min: 0,
        max: 1,
      },
    ],
  };
}

/**
 * The states of a sensor: its value (when it has one) and its error flag.
 * Text values are `{ text }`, the others numbers.
 * @returns {Array<{ externalId: string, value: number|string, text?: boolean }>}
 */
export function sensorStates(gladys, sensor, reading) {
  if (!reading) {
    return [];
  }
  const ids = sensorIds(gladys, sensor.slot);
  const states = [{ externalId: ids.feature(ERROR_FEATURE), value: reading.failing ? 1 : 0 }];
  if (reading.value !== null && reading.value !== undefined) {
    states.push({
      externalId: ids.feature(valueFeatureKey(sensor.type)),
      value: reading.value,
      text: sensor.type === 'text',
    });
  }
  return states;
}
