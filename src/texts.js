// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the configuration action report, feature names,
// scene event variables, scene action messages. Four languages, the four of
// the Gladys interface; German says "du", Spanish "usted". test/i18n.test.js
// checks every table.
// -----------------------------------------------------------------------------

import { SLOT_ERRORS } from './config.js';
import { HTTP_ERRORS } from './http.js';
import { VALUE_ERRORS } from './sensors.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noSensor: {
    en: 'Enter the address of a first sensor in the configuration.',
    fr: "Saisissez l'adresse d'un premier capteur dans la configuration.",
    de: 'Gib die Adresse eines ersten Sensors in der Konfiguration ein.',
    es: 'Introduzca la dirección de un primer sensor en la configuración.',
  },
  allFailing: {
    en: 'Every sensor fails: use "Test the sensors" to see why.',
    fr: 'Tous les capteurs échouent : « Tester les capteurs » dit pourquoi.',
    de: 'Alle Sensoren scheitern: „Sensoren testen“ zeigt, warum.',
    es: 'Todos los sensores fallan: «Probar los sensores» indica por qué.',
  },
};

// A field of a slot that cannot be used (src/config.js).
export const SLOT_ERROR_TEXT = {
  [SLOT_ERRORS.URL]: {
    en: 'address not understood, e.g. http://192.168.1.20/api/status',
    fr: 'adresse incomprise, ex. http://192.168.1.20/api/status',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.20/api/status',
    es: 'dirección no válida, p. ej. http://192.168.1.20/api/status',
  },
  [SLOT_ERRORS.PATH]: {
    en: 'field path or regular expression not understood',
    fr: 'chemin du champ ou expression régulière incompris',
    de: 'Feldpfad oder regulärer Ausdruck nicht verstanden',
    es: 'ruta del campo o expresión regular no válida',
  },
  [SLOT_ERRORS.HEADERS]: {
    en: 'headers not understood: one "Name: value" per line',
    fr: 'en-têtes incompris : un « Nom: valeur » par ligne',
    de: 'Header nicht verstanden: ein „Name: Wert“ pro Zeile',
    es: 'cabeceras no válidas: un «Nombre: valor» por línea',
  },
  [SLOT_ERRORS.SECRET]: {
    en: 'secret header not understood',
    fr: 'en-tête secret incompris',
    de: 'Geheimer Header nicht verstanden',
    es: 'cabecera secreta no válida',
  },
  [SLOT_ERRORS.NUMBER]: {
    en: 'multiplier or offset is not a number',
    fr: "le multiplicateur ou le décalage n'est pas un nombre",
    de: 'Multiplikator oder Verschiebung ist keine Zahl',
    es: 'el multiplicador o el desplazamiento no es un número',
  },
};

// One short explanation per error kind of a reading (src/http.js, src/sensors.js).
export const ERROR_TEXT = {
  [HTTP_ERRORS.UNREACHABLE]: {
    en: 'no answer',
    fr: 'pas de réponse',
    de: 'keine Antwort',
    es: 'sin respuesta',
  },
  [HTTP_ERRORS.TIMEOUT]: {
    en: 'no answer in time',
    fr: 'pas de réponse à temps',
    de: 'keine rechtzeitige Antwort',
    es: 'sin respuesta a tiempo',
  },
  [HTTP_ERRORS.TLS]: {
    en: 'certificate refused: untick "Check the certificate"',
    fr: 'certificat refusé : décochez « Vérifier le certificat »',
    de: 'Zertifikat abgelehnt: Deaktiviere „Zertifikat prüfen“',
    es: 'certificado rechazado: desmarque «Verificar el certificado»',
  },
  [HTTP_ERRORS.STATUS]: {
    en: 'error answer',
    fr: "réponse d'erreur",
    de: 'Fehlerantwort',
    es: 'respuesta de error',
  },
  [HTTP_ERRORS.TOO_LARGE]: {
    en: 'answer too large',
    fr: 'réponse trop grande',
    de: 'Antwort zu groß',
    es: 'respuesta demasiado grande',
  },
  [HTTP_ERRORS.REDIRECT]: {
    en: 'redirected to another address, refused',
    fr: 'redirigé vers une autre adresse, refusé',
    de: 'an eine andere Adresse umgeleitet, abgelehnt',
    es: 'redirigido a otra dirección, rechazado',
  },
  [VALUE_ERRORS.NOT_JSON]: {
    en: 'the answer is not JSON',
    fr: "la réponse n'est pas du JSON",
    de: 'die Antwort ist kein JSON',
    es: 'la respuesta no es JSON',
  },
  [VALUE_ERRORS.NOT_FOUND]: {
    en: 'field not found in the answer',
    fr: 'champ introuvable dans la réponse',
    de: 'Feld nicht in der Antwort gefunden',
    es: 'campo no encontrado en la respuesta',
  },
  [VALUE_ERRORS.NO_MATCH]: {
    en: 'the regular expression finds nothing',
    fr: "l'expression régulière ne trouve rien",
    de: 'der reguläre Ausdruck findet nichts',
    es: 'la expresión regular no encuentra nada',
  },
  [VALUE_ERRORS.NOT_NUMBER]: {
    en: 'the value is not a number',
    fr: "la valeur n'est pas un nombre",
    de: 'der Wert ist keine Zahl',
    es: 'el valor no es un número',
  },
  [VALUE_ERRORS.NOT_BINARY]: {
    en: 'the value is neither on nor off',
    fr: "la valeur n'est ni vraie ni fausse",
    de: 'der Wert ist weder an noch aus',
    es: 'el valor no es ni verdadero ni falso',
  },
  [VALUE_ERRORS.EMPTY]: {
    en: 'the value is empty',
    fr: 'la valeur est vide',
    de: 'der Wert ist leer',
    es: 'el valor está vacío',
  },
  [VALUE_ERRORS.REGEX_TIMEOUT]: {
    en: 'the regular expression takes too long',
    fr: "l'expression régulière prend trop de temps",
    de: 'der reguläre Ausdruck dauert zu lange',
    es: 'la expresión regular tarda demasiado',
  },
  config: {
    en: 'configuration to fix',
    fr: 'configuration à corriger',
    de: 'Konfiguration korrigieren',
    es: 'configuración por corregir',
  },
};

export const FEATURE_TEXT = {
  error: { en: 'In error', fr: 'En erreur', de: 'Fehlerhaft', es: 'En error' },
  sensor: { en: 'HTTP sensor', fr: 'Capteur HTTP', de: 'HTTP-Sensor', es: 'Sensor HTTP' },
};

// "Test the sensors", one language at a time.
export const REPORT_TEXT = {
  en: {
    none: 'No sensor yet: enter an address in a slot of the configuration.',
    sensors: (count) => `${count} sensor(s)`,
  },
  fr: {
    none: 'Aucun capteur : saisissez une adresse dans un emplacement de la configuration.',
    sensors: (count) => `${count} capteur(s)`,
  },
  de: {
    none: 'Noch kein Sensor: Gib eine Adresse in einem Platz der Konfiguration ein.',
    sensors: (count) => `${count} Sensor(en)`,
  },
  es: {
    none: 'Ningún sensor: introduzca una dirección en una ranura de la configuración.',
    sensors: (count) => `${count} sensor(es)`,
  },
};

export const ACTION_TEXT = {
  badUrl: {
    en: 'Address not understood: it starts with http:// or https://.',
    fr: 'Adresse incomprise : elle commence par http:// ou https://.',
    de: 'Adresse nicht verstanden: Erlaubt sind http:// und https://.',
    es: 'Dirección no válida: empieza por http:// o https://.',
  },
  badPath: SLOT_ERROR_TEXT[SLOT_ERRORS.PATH],
  badHeaders: SLOT_ERROR_TEXT[SLOT_ERRORS.HEADERS],
  secretHost: {
    en: 'The secret header of a sensor is only sent to the host of that sensor.',
    fr: "L'en-tête secret d'un capteur n'est envoyé qu'à l'hôte de ce capteur.",
    de: 'Der geheime Header eines Sensors geht nur an den Host dieses Sensors.',
    es: 'La cabecera secreta de un sensor solo se envía al host de ese sensor.',
  },
  unknownSensor: {
    en: 'Unknown sensor: choose a device of this integration.',
    fr: 'Capteur inconnu : choisissez un appareil de cette intégration.',
    de: 'Unbekannter Sensor: Wähle ein Gerät dieser Integration.',
    es: 'Sensor desconocido: elija un dispositivo de esta integración.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** The explanation of a reading error, in one language: "error answer (HTTP 500)". */
export function errorText(error, language) {
  if (!error) {
    return '';
  }
  const text = pick(ERROR_TEXT[error.kind] ?? ERROR_TEXT.unreachable, language);
  if (error.kind === HTTP_ERRORS.STATUS) {
    return `${text} (HTTP ${error.status})`;
  }
  if (error.kind === 'config') {
    return pick(SLOT_ERROR_TEXT[error.detail] ?? ERROR_TEXT.config, language);
  }
  return error.detail ? `${text} (${error.detail})` : text;
}
