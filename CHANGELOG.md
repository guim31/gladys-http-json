# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]

### Added

- Up to 10 HTTP sensors, one per slot of the configuration: address, method
  (GET or POST), headers, a secret header for the token (never logged), body,
  reading interval from 30 seconds to 1 hour, certificate check (on by default).
- Where the value is: a field path in a JSON answer (`data.items[0].temp`,
  `$.list[-1].v`, `items[?(@.name=='kitchen')].temp`), a regular expression on
  a text answer or a web page, or the whole answer.
- Types: number, temperature, humidity, percentage, power, energy, binary
  (on/off) and text, with a multiplier and an offset for the numbers.
- A device per sensor, with its value and an "In error" feature (after two
  failed readings in a row), and a local/cloud badge.
- "Test the sensors": reads every sensor now and says what each one gives.
- Dashboard widget "HTTP values": one row per sensor, with a Refresh button.
- Scene triggers "A sensor fails" (HTTP code, error) and "A text value
  changes" (new and previous value).
- Scene actions "Call an address" (method, headers, body with scene values,
  the secret header of a sensor towards its host only; the code, the answer
  and the value read as outputs) and "Read a sensor now".
- Answers capped at 1 MB and 10 seconds, redirects followed on the same host
  only.
- English, French, German and Spanish everywhere, documentation included.
