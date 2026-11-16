# RemedacareHMS lab bridge

Connects laboratory analysers to RemedacareHMS. Runs on any Windows or Linux PC in the lab that can reach the
analysers (network cable, serial/USB, or a shared export folder) and the internet.

## Easiest set-up (Windows, no technical steps)

1. In RemedacareHMS: **Laboratory → Analyzers → Connect an analyser**, create the key, choose how the analyser is
   connected, and click **Download lab bridge (.zip)**. Everything (key, address, settings) is already inside.
2. Copy the zip to the lab PC on a USB stick (it contains the analyser's secret key — do not email it).
3. On the lab PC: right-click the zip → **Extract All**, open the folder, double-click **INSTALL**.
   It installs Node.js if needed, copies the bridge to a permanent folder, makes it start whenever the PC is
   logged in, starts it, and shows the PC's network address to type into the analyser's LIS settings.
4. Follow **READ ME FIRST.txt** in the zip for the one setting to change on the analyser.

To check it later, open **Lab bridge log** on the Desktop. To remove it, double-click **UNINSTALL**.
The manual set-up below is for Linux or for IT staff who want to run several analysers from one bridge.

## Files

| File | What it does |
| --- | --- |
| `bridge.mjs` | The program: listens to analysers and sends results to `lab-ingest` |
| `protocols.mjs` | ASTM E1381/E1394 and HL7 v2 (MLLP) handling, including ACK/NAK and checksums |
| `delivery.mjs` | Durable retry queue: every batch is saved to disk before sending |
| `csv.mjs` | Reads CSV exports (`sample_id, measured_at, code, value, unit, flag`) |
| `config.example.json` | Example configuration |

## Set up (once per laboratory)

1. In RemedacareHMS, open **Laboratory → Analysers**, add each analyser and copy the key that is shown **once**.
2. On the lab PC install Node.js 20 or newer, copy this folder, and create `config.json` from the example:

   ```bash
   cp config.example.json config.json
   ```

   Put your project's address in `endpoint`, and each analyser's key, protocol and connection in `analysers`.
   For serial (RS-232 / USB) analysers also run `npm install serialport`.
3. On each analyser, open its LIS / host settings:
   - **Network, analyser connects to the PC** (most modern analysers): set the host IP to the lab PC and the port to
     the one in `config.json`; use `"transport": "tcp-server"`.
   - **Network, PC connects to the analyser**: `"transport": "tcp-client"` with the analyser's `host` and `port`.
   - **Serial**: `"transport": "serial"`, the COM port (`COM3`, `/dev/ttyUSB0`) and the baud rate set on the analyser.
   - **CSV export folder**: `"protocol": "csv", "transport": "folder"` and the `folder` the analyser software exports to.
     Read files move to `done/`; files that cannot be read move to `failed/` with an `.error.txt` explaining why.
   - Protocol: `astm` (ASTM E1381/E1394, also called LIS2-A2) or `hl7` (HL7 v2 over MLLP). The analyser manual says which.
4. Start it:

   ```bash
   node bridge.mjs config.json
   ```

   To keep it running after restarts, install it as a service (Windows: NSSM or Task Scheduler "at startup";
   Linux: a systemd unit).

## How results flow

Analyser → bridge (handshake and checksum check) → local queue (`queue/`) → RemedacareHMS `lab-ingest` → matched to the
order by the **sample barcode** → mapped to the result template → **Laboratory → Analyser inbox** → a scientist accepts
(or auto-accept, if switched on for that analyser) → the result appears on the order, with delta checks,
auto-validation and critical-result alerts.

The sample ID scanned or entered on the analyser must be the barcode printed by RemedacareHMS for that order.

## Codes

Common codes (WBC, HGB, PLT, NA, K, CL, UREA, CREA, ALT, AST, TBIL, ALB …) are mapped already, with unit conversion
(for example haemoglobin g/L → g/dL, creatinine mg/dL → µmol/L). Anything else shows as "unmapped" in the inbox; add a
mapping there once and it is remembered.

## Tests

`npm test` in the project runs the bridge tests in this folder (protocols, queue, CSV and payload validation).
