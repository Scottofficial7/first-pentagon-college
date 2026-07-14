/**
 * Runs during `vercel build` (see package.json "build" script and vercel.json).
 * Reads Firebase config out of Environment Variables (set in the Vercel
 * dashboard under Project Settings → Environment Variables) and writes a
 * plain firebase-config.js into the project root so the static portals can
 * load it via <script src="firebase-config.js">.
 *
 * firebase-config.js itself is gitignored — it only ever exists locally
 * (copied from firebase-config.example.js) or as a build artifact on Vercel.
 */
const fs = require("fs");
const path = require("path");

const required = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(
    `\n[build-config] Missing required environment variable(s): ${missing.join(", ")}\n` +
    `Set these in Vercel → Project Settings → Environment Variables.\n`
  );
  process.exit(1);
}

const config = {
  apiKey:            process.env.FIREBASE_API_KEY,
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.FIREBASE_PROJECT_ID,
  storageBucket:      process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.FIREBASE_APP_ID,
  measurementId:     process.env.FIREBASE_MEASUREMENT_ID || "",
};

const output =
  `/**\n` +
  ` * AUTO-GENERATED at build time by scripts/build-config.js — do not edit or commit.\n` +
  ` * Source values come from Vercel Environment Variables.\n` +
  ` */\n` +
  `window.FIREBASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`;

const outPath = path.join(__dirname, "..", "firebase-config.js");
fs.writeFileSync(outPath, output);
console.log(`[build-config] Wrote ${outPath}`);
