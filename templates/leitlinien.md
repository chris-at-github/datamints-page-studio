# Gestaltungsleitlinien

Einzige Quelle für die Gestaltungsleitlinien aller Projekte. Die Skripte setzen daraus zusammen:
CLAUDE.md der Abzüge (Annotationen), Systemprompt der Entwürfe, Briefing für claude.ai und Paket für neue Projekte.
„Für alle Projekte“ gilt immer, „Zusätzlich bei bestehenden Websites“ nur für Abzüge bestehender Websites,
„Zusätzlich bei neuen Projekten“ nur für Projekte ohne bestehende Website,
„Rangfolge“ nur bei Läufen in Page Studio (Annotationen und Entwürfe). Leerzeilen werden beim Einsetzen entfernt.

## Für alle Projekte
- Gestalterisch hochwertig und eigenständig, passend zu Regeln, Tokens und Hintergrund des Projekts.
- Kein Template-Look: Die Gestaltung entsteht aus Inhalt und Zweck des Elements, nicht aus Effekten. Verläufe oder Transparenzen nur, wenn sie dem Inhalt dienen. Keine Emojis.
- Rundungen und Schatten gezielt einsetzen, wo sie etwas bedeuten (z. B. Ebenen, Hervorhebung), nicht als Dekoration überall gleich. Schließen die Regeln des Projekts sie aus (z. B. „Rundungen und Schatten: keine“), gilt das.
- Kein Tailwind, kein UI-Framework. Reines, gut strukturiertes CSS mit Custom Properties.
- Design-Tokens sind die Grundlage. Gesperrte Tokens sind fest: verwenden, nie abwandeln oder ersetzen. Braucht die Gestaltung Stufen, die es als Token nicht gibt (z. B. Schriftgrößen einer Überschriften-Hierarchie, Abstände, Flächen), leite sie aus den Tokens ab (calc(), clamp(), color-mix()). Keine Farbtöne außerhalb der Palette.
- Responsiv von 360 px bis 1440 px (Mobile first, clamp() für fließende Größen): Umbrüche, Abstände, Schriftgrößen, Touch-Flächen mindestens 44 × 44 px.
- Barrierefreiheit: semantische Elemente, sinnvolle Überschriftenebenen, Kontrast nach WCAG AA, Alternativtexte, sichtbarer Fokus, prefers-reduced-motion beachten.

## Zusätzlich bei bestehenden Websites
- Ziel ist ein spürbar moderneres Erscheinungsbild. Die Marke bleibt erkennbar: Farbwelt, Schrift und Tonalität.
- Frei gestalten darfst du Komposition, Hierarchie, Typografie im Detail (Größen, Gewichte, Zeilenabstände), Flächen, Bildwirkung und Rhythmus.
- Weichst du bei Farbwelt, Schrift oder Tonalität ab, begründe es in der Zusammenfassung.
- Tokens beachten: Für alles, wofür es einen passenden Token gibt, verwendest du ihn, auch wenn er nicht gesperrt ist. Abgeleitet wird nur, was fehlt.

## Zusätzlich bei neuen Projekten
- Die Tokens sind die Palette: verwende sie, wo sie passen, und leite fehlende Stufen daraus ab.

## Rangfolge
1. Sicherheits- und Arbeitsregeln (CLAUDE.md des Abzugs bzw. die Entwurfsregeln): Dateien, keine Scripts, keine fremden Domains.
2. Verbindliche Vorgaben des Projekts: gesperrte Tokens, Regeln aus notes.md, gleiche Bereiche, Bausteine „wie bisher“.
3. Diese Gestaltungsleitlinien.
4. Hintergrundwissen aus den weiteren Dateien in design/ (Angebot, Inhalte, Funktionen, Zielgruppen des Projekts).
5. Die mitgegebenen Gestaltungs-Skills (z. B. „impeccable“, „frontend-design“), untereinander in der mitgegebenen Reihenfolge. Sie gelten nur innerhalb der Grenzen 1–4 (Palette und Schrift kommen aus den Tokens). Nutze sie für Haltung, Hierarchie, Komposition, Typografie im Detail, Weißraum und Feinschliff. Rückfragen sind nicht möglich: triff begründete Annahmen und nenne sie in der Zusammenfassung.
