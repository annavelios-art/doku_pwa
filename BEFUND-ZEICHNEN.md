# Zeichenbefund – Stand 08.10.2026

Diese Erweiterung basiert auf der gelieferten aktuellen Version mit V3-Hauptbetrieb.

## Einbau

Die Dateien dieses Projekts in das bestehende GitHub-Repository übernehmen. Die eigenen lokalen Zugangsdaten (.env) beibehalten; sie sind in dieser ZIP nicht enthalten. Es werden keine neuen Pakete und keine Datenbankänderungen benötigt. Danach wie bisher veröffentlichen.

## Benutzung

1. Patient öffnen → Dokumente / Befunde → „Dokument“.
2. Datum und Überschrift eintragen und „Befund zeichnen“ wählen.
3. Rot für Markierungen, Blau für handschriftliche Notizen. Rechts ist Platz für freie Skizzen.
4. Mit Finger, Stift oder Maus zeichnen. Der Radierer entfernt nur Markierungen. Rückgängig und Wiederholen sind vorhanden.
5. Bei Bedarf vergrößern; mit „Verschieben“ das Blatt verschieben. Zum Zeichnen wieder Rot oder Blau auswählen.
6. „Zeichnung übernehmen“ und anschließend im Formular „Speichern“ drücken.
7. Einen gespeicherten Befund öffnen → „Zeichnung bearbeiten“.
8. Für eine Verlaufskontrolle zuerst „Als neuen Befund übernehmen“ wählen, dann bearbeiten und speichern. Der bisherige Eintrag bleibt erhalten.

Die Körpervorlage wird in hellen Graustufen dargestellt. Die Zeichnung wird als PNG einschließlich bearbeitbarer Zeichenstriche gespeichert und nutzt den vorhandenen V3-Verschlüsselungs- und Dateispeicherweg. Nicht mit einer externen Bildbearbeitung neu speichern, wenn die Zeichenstriche später weiterbearbeitet werden sollen: Solche Programme können Zusatzdaten entfernen.

V3 verlangt für das Speichern von Dateien weiterhin eine Online-Verbindung. „Zeichnung übernehmen“ allein speichert den Befund noch nicht dauerhaft. Das abschließende „Speichern“ ist erforderlich.

## Änderungen und Prüfung

Geändert: src/App.jsx und vite.config.js (Vorlage in den Offline-Cache aufnehmen).
Neu: src/components/BefundDrawing.jsx, src/components/BefundDrawing.css, src/lib/befundDrawing.js, src/assets/befund-vorlage.gif und diese Anleitung.

Beim Laden eines Dokumentkonflikts wird im V3-Hauptbetrieb jetzt der vorhandene V3-Dateilader verwendet.

Geprüft: Produktionsbuild; ESLint für die neuen JavaScript-Dateien; PNG-Zeichenstriche speichern und wieder einlesen; Erkennung beschädigter Zeichenmetadaten. Die Tests verwendeten vorhandene lokale Abhängigkeiten; package.json und package-lock.json wurden nicht verändert.

Ein Browser- und Tablet-Funktionstest sowie ein tatsächlicher Speichertest am angemeldeten V3-System sind hier noch nicht erfolgt. Bitte zunächst mit einem Testpatienten prüfen: speichern, neu öffnen, weiterzeichnen, erneut speichern; anschließend auf dem anderen Gerät öffnen. Ebenso die Übernahme als neuer Befund prüfen.
