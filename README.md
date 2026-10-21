# HTTP / JSON sensors for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that turns any address answering over HTTP into a sensor — a JSON API (a
router, a NAS, a solar inverter, a smart plug, a public API), a plain text
answer or a web page — and lets your scenes call any address. The Gladys
counterpart of the `rest` and `scrape` integrations of Home Assistant.

## Features

- **Up to 10 sensors**, one per slot of the configuration: address, method
  (GET or POST), headers, a secret header for a token (never logged), body,
  reading interval (30 seconds to 1 hour), certificate check.
- **Where the value is**: a field path in a JSON answer (`data.items[0].temp`,
  `$.list[-1].v`, `items[?(@.name=='kitchen')].temp`), a regular expression
  on a text answer or a web page (`/Temp: ([0-9.]+)/`), or the whole answer.
- **Types**: number, temperature (°C), humidity (%), percentage (%), power (W),
  energy (kWh), binary (on/off), text — with a multiplier and an offset for
  the numbers.
- **Devices**: one per sensor, with its value and an "In error" feature; the
  badge says local or cloud.
- **Dashboard widget** "HTTP values": one row per sensor, with a Refresh
  button.
- **Scene triggers**: "A sensor fails" (HTTP code and error as variables), "A
  text value changes" (new and previous value).
- **Scene actions**: "Call an address" (method, headers, body with scene
  values; the code, the answer and a value read in it go to the next steps)
  and "Read a sensor now".
- **Bounded**: answers of 1 MB and 10 seconds at most, redirects followed on
  the same host only, regular expressions stopped after half a second.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Addresses the Gladys machine can reach, on the local network (private
  addresses are allowed) or on the Internet.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-http-json`
   (or install **HTTP / JSON sensors** from the catalog once it is listed).
2. In **Configuration**, fill in a slot: an address, where the value is, its
   type. Save, then click **Test the sensors**.
3. Open the **Discover** tab and add the sensors to follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The integration reads each sensor on its own timer, at the interval of the
sensor (Gladys never polls: the devices are published with
`should_poll: false`). A failed reading is tried again after 30 seconds; the
sensor is "in error" after two failures in a row, and "A sensor fails" fires
once, until it works again. The states of the added devices are sent only when
they change (and every 6 hours). The identity of a device is its slot number:
renaming a sensor or changing its address keeps its device and history. The
failures announced and the last texts read are kept in `/data`, so a restart
neither announces a failure twice nor reports a text change that is only a
restart.

## Tested

- The HTTP client against a real server: answers over 1 MB, slow answers that
  trickle in, redirects (same host, another host, loops, 303 after a POST).
- The integration image under the constraints of the Gladys sandbox
  (`--cap-drop ALL`, read-only rootfs, 256 MB), against a test web server in
  Docker (JSON, text, HTML, 401, 500, a slow and an oversized answer) and the
  public [Open-Meteo](https://open-meteo.com/) API, driven by the fake Gladys
  of the SDK. Details in [`CLAUDE.md`](CLAUDE.md).

## Limitations

- 10 sensors, one value each (several slots can share an address).
- No cookies, no login form, no JavaScript rendering: use the API behind a
  page.
- The units are the ones of the types; a number in another unit goes in
  "Number (no unit)".
- A comma or dot as thousands separator (`1,234.5`) needs a regular
  expression.
- Respect the terms and quotas of the APIs you read: the interval is yours.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK, an in-memory web
(`test/helpers/world.js`) and, for the HTTP client, a real server on the
loopback interface. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- Started from the official
  [integration template](https://github.com/GladysAssistant/integration-template-js)
  and the [integration SDK](https://github.com/GladysAssistant/integration-sdk-js)
  of Gladys Assistant (Apache-2.0).
- The [RESTful](https://www.home-assistant.io/integrations/rest/) and
  [Scrape](https://www.home-assistant.io/integrations/scrape/) integrations of
  Home Assistant (Apache-2.0) were read for the use case; no code is copied
  from them.
- Configuration slots and sensor types shared with
  [gladys-influxdb](https://github.com/guim31/gladys-influxdb), the scene call
  with [gladys-n8n](https://github.com/guim31/gladys-n8n).
- A real answer of the [Open-Meteo](https://open-meteo.com/) API (CC BY 4.0)
  is used as a test fixture.

## Disclaimer

Not affiliated with any of the services it can read. Home Assistant is a
trademark of the Open Home Foundation.

## License

[Apache-2.0](LICENSE)
