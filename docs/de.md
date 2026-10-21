# HTTP-/JSON-Sensoren

Mach aus jeder Adresse, die per HTTP antwortet, einen Gladys-Sensor: eine
JSON-API (Router, NAS, Solarwechselrichter, smarte Steckdose, öffentliche
API), eine reine Textantwort oder eine Webseite. Du gibst an, wo der Wert in
der Antwort steht und welchen Typ er hat (Temperatur, Leistung, Energie,
an/aus, Text…): Er wird ein Gerät, gelesen im gewählten Intervall. Deine
Szenen können außerdem jede Adresse aufrufen, mit Werten der Szene, und die
Antwort in den nächsten Schritten nutzen.

Das ist das Gegenstück in Gladys zu den Integrationen `rest` und `scrape` von
Home Assistant. Geschrieben wird nur an die Adressen, die du eingibst.

Getestet mit einem Test-Webserver (JSON, Text, HTML, Fehler 401 und 500,
langsame und zu große Antworten, Umleitungen) und der öffentlichen API von
Open-Meteo, im abgesicherten Container von Gladys. Rückmeldungen willkommen:
[github.com/guim31/gladys-http-json/issues](https://github.com/guim31/gladys-http-json/issues).

## Voraussetzungen

- Gladys Assistant 5.1.0 oder neuer.
- Eine Adresse, die der Gladys-Rechner erreicht: in deinem lokalen Netz
  (private Adressen sind erlaubt, sie sind der Hauptzweck) oder im Internet.
- Falls die Adresse es verlangt, ihr Token oder Schlüssel (siehe **Geheimer
  Header (Token)**).

## Erste Schritte

### 1. Einen Platz ausfüllen

Die Konfiguration hat 10 Plätze, **Sensor 1** bis **Sensor 10**. Ein Platz mit
einer **Adresse (URL)** ist ein Sensor; eine leere Adresse lässt den Platz
frei. Jeder Platz hat diese Felder:

- **Name**: der Name des Geräts (leer: „HTTP-Sensor 3“).
- **Adresse (URL)**: `http://` oder `https://`, z. B.
  `http://192.168.1.20/api/status`. Ohne Schema wird `http://` verwendet.
  Benutzer und Passwort in der Adresse werden abgelehnt: Nutze den geheimen
  Header.
- **Methode**: GET oder POST.
- **Header**: ein `Name: Wert` pro Zeile, oder mehrere mit `|` getrennt,
  z. B. `Accept: application/json | X-Room: pool`.
- **Geheimer Header (Token)**: nie wieder angezeigt, nie in den Protokollen.
  Ein Token allein wird als `Authorization: Bearer <Token>` gesendet;
  `Basic …` oder `Token …` gehen wie eingegeben nach `Authorization:`; ein
  ganzer Header wie `X-Api-Key: abc123` geht unverändert.
- **Inhalt (POST)**: nur bei POST gesendet; JSON geht als
  `application/json`, alles andere als Text.
- **Feldpfad oder /regulärer Ausdruck/**: wo der Wert steht (nächster
  Abschnitt).
- **Typ**: was der Wert ist (weiter unten).
- **Multiplikator** und **Verschiebung**: für Zahlen, Wert × Multiplikator +
  Verschiebung (z. B. `0,001`, um Wh in kWh umzurechnen, `0,1` für
  Zehntelgrad). Ein Dezimalkomma ist erlaubt. Leer: 1 und 0.
- **Leseintervall**: von 30 Sekunden bis 1 Stunde.
- **Zertifikat prüfen (https)**: standardmäßig aktiv; deaktiviere es für ein
  Gerät mit selbstsigniertem Zertifikat.

Unter **Optionen** legt **Sprache der Namen und Meldungen** die Namen der
Funktionen (beim Hinzufügen des Geräts festgelegt), die Szenenvariablen und
den Testbericht fest.

### 2. Angeben, wo der Wert steht

- **Eine JSON-Antwort**: ein Feldpfad. `data.temp`, `sensors[0].value`,
  `items[-1].price` (der letzte), `['schlüssel mit.punkten']`, oder die
  JSONPath-Formen `$.data.temp` und `items[?(@.name=='kueche')].temp` (das
  erste Element, dessen `name` gleich `kueche` ist; `==` und `!=`, Texte in
  Anführungszeichen, Zahlen, `true`, `false`, `null`).
- **Eine Textantwort oder eine Webseite**: ein regulärer Ausdruck zwischen
  Schrägstrichen, z. B. `/Temperatur: ([0-9.,]+)/`. Die erste Gruppe in
  Klammern ist der Wert (ohne Gruppe der ganze Treffer). Flags nach dem
  letzten Schrägstrich: `i` (Groß-/Kleinschreibung), `s`, `m`, `u`. Bei einer
  Webseite werden Tags aus dem Wert entfernt und die üblichen Entitäten
  (`&nbsp;`, `&deg;`…) dekodiert. Ein Ausdruck, der länger als eine halbe
  Sekunde braucht, wird abgebrochen.
- **Leer**: die ganze Antwort (ein Gerät, das `21.5` oder `ON` antwortet).

Eine Zahl in einem Text wird von selbst gefunden: `21,5 °C` ergibt 21,5.
Tausendertrennzeichen werden nicht verstanden (`1,234.5`): Schreib dafür einen
regulären Ausdruck.

### 3. Den Typ wählen

| Typ                      | Gladys-Funktion            | Der Wert              |
| ------------------------ | -------------------------- | --------------------- |
| **Zahl (ohne Einheit)**  | allgemeiner Sensor         | jede Zahl             |
| **Temperatur (°C)**      | Temperatur                 | Zahl                  |
| **Luftfeuchtigkeit (%)** | Luftfeuchtigkeit           | Zahl                  |
| **Prozent (%)**          | Füllstand                  | Zahl                  |
| **Leistung (W)**         | Leistung                   | Zahl (mit Vorzeichen) |
| **Energie (kWh)**        | Energie                    | Zahl                  |
| **Binär (an/aus)**       | Zustand des Eingangs (1/0) | siehe unten           |
| **Text**                 | Text                       | höchstens 250 Zeichen |

**Binär (an/aus)**: `true`, eine Zahl ungleich 0, `on`, `yes`, `up`,
`active`, `enabled` (und `oui`, `ja`, `si`) ergeben 1; `false`, 0, `off`,
`no`, `down`, `inactive`, `disabled` (und `non`, `nein`) ergeben 0. Alles
andere ist ein Fehler.

### 4. Die Geräte hinzufügen

Klicke auf **Sensoren testen**: Jeder Sensor wird sofort gelesen, und die
Antwort zeigt, was jeder liefert oder warum er nichts liefert. Füge die
Sensoren dann im Tab **Entdecken** der Integration hinzu.

## Die Geräte

Ein Gerät pro Sensor, mit zwei Funktionen:

- der Wert, vom Typ des Platzes;
- **Fehlerhaft**: 1, solange der Sensor scheitert, sonst 0.

Ein gescheiterter Lesevorgang wird nach 30 Sekunden wiederholt; der Sensor
ist nach zwei gescheiterten Lesevorgängen nacheinander fehlerhaft, eine
verlorene Antwort ändert also nichts. Der letzte Wert bleibt so lange stehen.
Das Badge des Geräts zeigt lokal oder Cloud (je nach Adresse), nicht
erreichbar, solange er fehlerhaft ist.

Ändern von Adresse, Pfad, Typ oder einem Header eines Platzes behält das Gerät
und seinen Verlauf (die Identität ist die Nummer des Platzes). Ein neuer Typ
fügt eine neue Wertfunktion hinzu: Klicke auf **Aktualisieren** im Tab
Entdecken.

## Dashboard

Das Widget **HTTP-Werte** zeigt eine Zeile pro Sensor: den Wert mit seiner
Einheit oder „Fehler“. In seinen Einstellungen wählst du die anzuzeigenden
Sensoren (leer: alle; nur die in Gladys angelegten Geräte sind wählbar).
**Aktualisieren** liest sie sofort neu.

## Szenen

### Auslöser

- **Ein Sensor scheitert**: Zwei Lesevorgänge nacheinander scheitern (keine
  Antwort, HTTP-Fehler, Wert fehlt, Konfiguration korrigieren). Einmal, bis
  der Sensor wieder geht. Filter: ein Sensor oder beliebig. Variablen: der
  Name des Sensors, der Fehler, sein Schlüssel (`status`, `timeout`,
  `unreachable`, `tls`, `too_large`, `redirect`, `not_json`, `not_found`,
  `no_match`, `not_number`, `not_binary`, `empty`, `config`…) und der
  HTTP-Code (0 ohne Antwort).
- **Ein Textwert ändert sich**: Ein Sensor vom Typ **Text** liest einen
  anderen Wert als zuletzt (nicht beim ersten Lesen, nicht nach einem
  Neustart). Variablen: der Name des Sensors, der neue und der vorherige Wert.

Für eine Zahl, die eine Schwelle überschreitet, nutze den Wert des Geräts in
einer Szenenbedingung wie bei jedem Sensor.

### Aktionen

- **Adresse aufrufen**: sendet eine Anfrage — Adresse, Methode (GET, POST,
  PUT, PATCH, DELETE), Header, Inhalt —, in die Werte der Szene eingefügt
  werden können (tippe `{{`). Bei GET wird kein Inhalt gesendet. **Geheimer
  Header von Sensor** fügt den geheimen Header eines Sensors hinzu, **nur
  wenn die Adresse auf dem Host dieses Sensors liegt**: Eine Szene kann ihn
  nicht anderswohin schicken (in einer Szene lässt sich kein Geheimnis
  eingeben, jeder Benutzer kann sie lesen). Ein optionaler Feldpfad oder
  regulärer Ausdruck liest einen Wert aus der Antwort.
- **Sensor jetzt lesen**: liest einen Sensor, ohne auf sein Intervall zu
  warten, und veröffentlicht seinen Wert.

Beide geben den nächsten Aktionen: **Erfolgreich**, den **HTTP-Code (0: keine
Antwort)**, den **Gelesenen Wert**, den **Wert als Zahl (0 wenn keiner)** und
den **Fehler**; **Adresse aufrufen** gibt außerdem die **Antwort (höchstens
2000 Zeichen)**. Eine gescheiterte Anfrage hält die Szene nicht an: Prüfe
**Erfolgreich**.

### Szenenideen

- Jeden Abend um 22 Uhr **Adresse aufrufen**
  `http://192.168.1.30/relay/0?turn=off`, um ein Shelly-Relais
  auszuschalten, dann eine Nachricht senden, wenn **Erfolgreich** falsch ist.
- **Ein Sensor scheitert** beim NAS-Sensor: „NAS: “ und die Variable
  **Fehler** an dein Handy senden.
- Wenn die Alarmanlage scharf geschaltet wird, **Adresse aufrufen** auf einem
  Webhook (Node-RED, n8n, Home Assistant) mit POST und dem Inhalt
  `{"alarm": "scharf"}`.
- **Sensor jetzt lesen** für die Pooltemperatur, bevor die Pumpe startet, dann
  eine Bedingung auf den Wert.

## Fehlerbehebung

- **Feld nicht in der Antwort gefunden**: Öffne die Adresse im Browser und
  kopiere den Pfad zum Wert (Firefox zeigt JSON als Baum, „Pfad kopieren“
  steht im Kontextmenü eines Werts). Listen zählen ab 0.
- **Die Antwort ist kein JSON**: Die Adresse liefert eine Seite oder einen
  Text: Nutze einen regulären Ausdruck, oder prüfe die Adresse (eine
  Anmeldeseite?).
- **Fehlerantwort (HTTP 401 oder 403)**: Token oder Schlüssel ist falsch oder
  fehlt: Fülle **Geheimer Header (Token)** aus.
- **Zertifikat abgelehnt**: Deaktiviere **Zertifikat prüfen (https)** für
  diesen Platz.
- **An eine andere Adresse umgeleitet, abgelehnt**: Die Adresse leitet auf
  einen anderen Host um (oft `http://` auf eine Cloud-Anmeldeseite). Gib die
  endgültige Adresse ein.
- **Keine rechtzeitige Antwort**: Die Adresse braucht mehr als 10 Sekunden.
- **Der Wert ist keine Zahl**: Der Pfad führt zu einem Text oder einer Liste;
  passe ihn an oder wähle den Typ **Text**.
- Protokolle: Setze die Variable `LOG_LEVEL=debug` der Integration, um jeden
  Lesevorgang zu sehen.

## Einschränkungen

- 10 Sensoren, je ein Wert. Für mehrere Werte einer Antwort nutze mehrere
  Plätze mit derselben Adresse.
- Antworten von höchstens 1 MB und 10 Sekunden (20 s bei einem Aufruf aus
  einer Szene), höchstens 3 Umleitungen, nur auf demselben Host.
- Keine Cookies, kein Anmeldeformular, kein JavaScript: Eine Seite, die erst
  im Browser per JavaScript entsteht, zeigt hier nichts. Nutze ihre API.
- Keine anderen Einheiten als die der Typen: Eine Zahl in einer anderen
  Einheit kommt in **Zahl (ohne Einheit)**.
- Beachte die Regeln der APIs, die du liest (Kontingente, Bedingungen): Das
  Intervall bestimmst du. Open-Meteo zum Beispiel bittet um weniger als
  10 000 Aufrufe pro Tag.
