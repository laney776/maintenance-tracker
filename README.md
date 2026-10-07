# E92 Servicebook

An offline-first maintenance planner and service log tailored to a BMW E92 325d M57. It is a Progressive Web App (PWA): one small app works in Safari on iPhone and in a browser on Mac, with no App Store account or subscription.

## Included

- Vehicle profile for the E92 325d M57, with editable year, registration, VIN, odometer, distance units, and currency.
- Editable maintenance plan with mileage intervals, time intervals, early alerts, categories, and notes.
- A service timeline with date, odometer, cost, workshop, parts/reference, and notes.
- Due-soon and overdue calculations. A task becomes due when either its mileage or date interval is reached.
- CSV history export, complete JSON backup/restore, and Apple Calendar reminders (`.ics`).
- Responsive iPhone layout, standalone Home Screen presentation, and offline shell caching after first open.

The current version does not connect to the Carista EVO. Enter the odometer manually; the app uses it to update mileage-based reminders.

## Service intervals

The starter list contains common maintenance categories, but it intentionally does not assign factory service intervals. Set intervals from the schedule you follow and the car's service history. For mileage tracking, log a previous service with its odometer reading and keep the current reading updated.

## Install on iPhone

The files need to be available from an HTTPS website before iPhone Safari can install the app and enable offline caching. After the app is hosted:

1. Open its HTTPS address in **Safari** on the iPhone.
2. Tap **Share**, then **Add to Home Screen**.
3. Launch **E92 Servicebook** from the Home Screen.

On Mac, open the same address in a browser. It can also be added to the Dock in recent versions of macOS Safari.

## Records and privacy

Records are saved locally in the browser on each device. This static app does not send vehicle data to a server. iPhone and Mac do not automatically share records; use **Backup & restore** to export a JSON backup on one device, then restore it on the other. Keep a separate backup copy somewhere safe.

Date reminders can be exported as an `.ics` calendar file once an item has a time interval and a service baseline. Mileage reminders appear in the app when you update the odometer. The app does not send background push notifications.

## Host the files

Publish the contents of this folder as a static website at an HTTPS address. Keep the directory structure intact, including `assets/`, `manifest.json`, and `sw.js`. No server-side code, database, analytics, or API key is required.
