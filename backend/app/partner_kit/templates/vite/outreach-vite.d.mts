// Tells TypeScript what outreach-vite.mjs exports, so importing it in vite.config.ts gives no type error.
import type { Plugin } from "vite";
export default function outreach(): Plugin;
