import { defineConfig } from "blume";

export default defineConfig({
  title: "Cashflow Hilfe",
  description:
    "Anleitung und Nachschlagewerk für Cashflow — Konzepte, Bildschirme und typische Abläufe.",

  // German is the app's primary language — LANGUAGES lists `de` first and the
  // signed-out shell renders in German — so it owns the unprefixed URLs and
  // English sits under /en. A page missing in one locale falls back to German
  // rather than 404ing, which keeps every sidebar entry reachable.
  i18n: {
    defaultLocale: "de",
    locales: [
      { code: "de", label: "Deutsch" },
      {
        code: "en",
        label: "English",
        // Pins register for anything `blume translate` generates later, so a
        // machine-written page reads like the hand-written ones next to it.
        style:
          "British English, second person, plain and concrete. No marketing register, no exclamation marks. Keep Swiss franc amounts and app screen names (Dashboard, Envelopes, Reconcile, Settings) as they are.",
      },
    ],
    fallbackLocale: "de",
  },

  content: { root: "docs" },

  // Needed for canonical URLs, the sitemap and OG images: this is a plain
  // static build behind Traefik, so nothing can detect the origin for us.
  deployment: { output: "static", site: "https://help.cash-flow.wi-wo.ch" },

  // The docs live in the app's repo under help-site/, so edit links need the
  // subdirectory or they point at a path that does not exist.
  github: {
    owner: "Jonas-Marty",
    repo: "cash-flow-jm",
    branch: "main",
    dir: "help-site",
  },

  navigation: {
    cta: { href: "https://cash-flow.wi-wo.ch", label: "Cashflow öffnen" },
  },

  theme: { accent: "teal", radius: "md", mode: "system" },
  search: { provider: "orama" },
  seo: { sitemap: true, robots: true, og: { enabled: true } },
})
