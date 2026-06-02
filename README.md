# PuffLabs Desktop

macOS desktop app for **PuffLabs Communications** (pufflabs.work) — an Electron shell
around the live web app with native menu-bar / background mode, notifications,
dock unread badge + bounce, a Preferences window, and in-app update checks.
Sign-in is Google OAuth handled in the system browser (`pufflabs://` deep link).

## Install
Grab the latest `PuffLabs.dmg` from **Releases**, drag PuffLabs to Applications.
First launch: right-click → Open (ad-hoc signed).

## Dev
```
npm install
npm start      # run the app
npm run dist   # build dist/*.dmg
```
