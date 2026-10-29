import { legalMarkdown, PRIVACY_PAYMENTS, TERMS, WITHDRAWAL } from '@music-hub/shared';
import { plansForSale } from './billing.js';

export type Locale = 'de' | 'en';

// A page anyone sees without logging in. Agents get it as <path>.md, listed in
// llms.txt and joined in llms-full.txt (routes/agents.ts). body is Markdown
// below the title and description and carries the page's content, not its
// layout. path is the page's URL, so the browser test can open it.
export type PublicPage = { path: string; title: string; description: string; body?: string };

// Every public page with its own content, in the given language. Never anything
// behind the login, nothing from projects, tracks or profiles, no admin pages.
// The legal pages repeat the text of their Svelte page: change both together,
// the browser test compares their headings.
// The terms and the privacy section about payments only while plans can be bought.
export function publicPages(locale: Locale): PublicPage[] {
  const pages = locale === 'en' ? [landingEn, privacy('en'), imprint('en')] : [landingDe, privacy('de'), imprint('de')];
  return plansForSale() ? [...pages, terms(locale)] : pages;
}

export const SITE = {
  de: {
    tagline: 'Versionen für Musik. Ohne Chaos.',
    intro: (full: string) =>
      `Nur öffentliche Inhalte. Jede Seite gibt es auch als Markdown: \`.md\` an die URL hängen, für die Startseite \`/index.md\`. Alles in einer Datei: ${full}`,
    pages: 'Seiten',
    otherLanguage: 'English',
  },
  en: {
    tagline: 'Versions for music. Without the chaos.',
    intro: (full: string) =>
      `Public content only. Every page is also available as Markdown: append \`.md\` to its URL, \`/index.md\` for the start page. Everything in one file: ${full}`,
    pages: 'Pages',
    otherLanguage: 'Deutsch',
  },
};

const landingDe: PublicPage = {
  path: '/',
  title: 'Music Hub',
  description: SITE.de.tagline,
  body: `Für Producer, Bands und alle, die am Song arbeiten: Music Hub hält jeden Stand fest, Kommentare sitzen auf der Sekunde, und am Ende ist klar, welcher Mix freigegeben ist. Kostenlos, solange Plätze frei sind. Zum Reinhören reicht ein Link.

## Schluss mit Final_v3_REAL.wav

Neue Version hochladen, die alte bleibt daneben. Statt Ordnern und Sprachnachrichten: ein Track, alle Versionen, jede mit Status und offenen Punkten.

## Feedback auf die Sekunde

Klick in die Wellenform und schreib, was dir auffällt. Der Kommentar hängt an der Version und an der Stelle, ein Klick auf den Zeitstempel spielt genau diese Stelle. Was in einer früheren Version offen geblieben ist, steht gleich darunter.

## Freigeben oder zurück an den Mix

Wer fertig gehört hat, sagt es mit einem Klick: freigeben, Änderungen nötig oder nur Anmerkungen. Wer hochgeladen hat, bekommt das Urteil und alle Anmerkungen in einer Nachricht.

## Für alle, die am Song arbeiten

- Producer und Engineers: Mixe per Drag-and-drop hochladen, auch mehrere auf einmal. Spuren pro Track, für den Mix als ZIP. Leertaste spielt, C kommentiert, ← und → wechseln die Version.
- Band, Artists und Kunden: am Handy anhören und kommentieren, als App installierbar. Zum Reinhören reicht ein Link, ganz ohne Account. Freigeben mit einem Tipp.

## Open Source

Music Hub ist Open Source (AGPL-3.0) und läuft auf Servern in Deutschland. Mit Docker und einem S3-Bucket läuft er auch auf deinem Server: https://github.com/robinchoice/music-hub`,
};

const landingEn: PublicPage = {
  path: '/',
  title: 'Music Hub',
  description: SITE.en.tagline,
  body: `For producers, bands and everyone working on a song: Music Hub keeps every version, comments sit on the exact second, and in the end it is clear which mix is approved. Free while places last. Listening only takes a link.

## No more Final_v3_REAL.wav

Upload a new version, the old one stays next to it. Instead of folders and voice messages: one track, all versions, each with its status and open points.

## Feedback to the second

Click into the waveform and write what you notice. The comment sticks to the version and the moment, a click on the timestamp plays exactly that spot. What stayed open in an earlier version shows right below.

## Approve or back to the mix

Whoever has finished listening says so with one click: approve, changes needed or just notes. The uploader gets the verdict and all notes in one message.

## For everyone working on the song

- Producers and engineers: upload mixes by drag and drop, several at once. Stems per track, as a ZIP for the mix. Space plays, C comments, ← and → switch the version.
- Bands, artists and clients: listen and comment on your phone, installable as an app. Listening only takes a link, no account needed. Approve with one tap.

## Open source

Music Hub is open source (AGPL-3.0) and runs on servers in Germany. With Docker and an S3 bucket it runs on your server too: https://github.com/robinchoice/music-hub`,
};

function imprint(locale: Locale): PublicPage {
  return {
    path: '/impressum',
    title: locale === 'de' ? 'Impressum' : 'Imprint',
    description: locale === 'de' ? 'Music Hub ist ein Angebot von Pleasance.' : 'Music Hub is run by Pleasance.',
    body: locale === 'de' ? IMPRINT_DE : IMPRINT_EN,
  };
}

const IMPRINT_DE = `## Angaben gemäß § 5 DDG

Robin Wahl
Pleasance
Bugginger Straße 37
79114 Freiburg

## Kontakt

E-Mail: hello@pleasance.org

## Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV

Robin Wahl
Bugginger Straße 37
79114 Freiburg

## Inhalte von Nutzerinnen und Nutzern

Audiodateien, Kommentare und andere Inhalte in den Projekten stammen von deren Mitgliedern und von Gästen mit einem geteilten Link. Wenn dir dort ein rechtswidriger Inhalt auffällt, schreib mir an hello@pleasance.org, dann prüfe ich ihn und entferne ihn gegebenenfalls.

## Haftung für Inhalte

Die Inhalte dieser Seite wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden.

## Haftung für Links

Diese Website enthält Links zu externen Websites Dritter, auf deren Inhalte kein Einfluss besteht. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter verantwortlich.`;

const IMPRINT_EN = `## Information pursuant to § 5 DDG

Robin Wahl
Pleasance
Bugginger Straße 37
79114 Freiburg

## Contact

Email: hello@pleasance.org

## Responsible for content pursuant to § 18 (2) MStV

Robin Wahl
Bugginger Straße 37
79114 Freiburg

## User-generated content

Audio files, comments and other content in the projects come from their members and from guests with a shared link. If you notice unlawful content there, write to me at hello@pleasance.org and I will review it and remove it if necessary.

## Liability for content

The content of this site was created with the greatest care. However, no guarantee can be given for the accuracy, completeness and timeliness of the content.

## Liability for links

This website contains links to external third-party websites over whose content we have no influence. The respective provider is always responsible for the content of the linked pages.`;

function privacy(locale: Locale): PublicPage {
  return {
    path: '/datenschutz',
    title: locale === 'de' ? 'Datenschutzerklärung' : 'Privacy policy',
    description:
      locale === 'de'
        ? 'Welche Daten Music Hub erhebt, wofür und wo sie liegen. Keine Werbung, kein Tracking.'
        : 'Which data Music Hub collects, what for and where it is stored. No ads, no tracking.',
    body: [locale === 'de' ? PRIVACY_DE : PRIVACY_EN, ...(plansForSale() ? [legalMarkdown({ title: '', meta: '', sections: [PRIVACY_PAYMENTS[locale]] })] : [])].join('\n\n'),
  };
}

function terms(locale: Locale): PublicPage {
  return {
    path: '/agb',
    title: TERMS[locale].title.replace('\u00AD', ''),
    description:
      locale === 'de'
        ? 'Bedingungen für Music Hub und die Tarife Pro und Studio, mit Widerrufsbelehrung.'
        : 'Terms for Music Hub and the Pro and Studio plans, with the cancellation notice.',
    body: [TERMS[locale].meta, legalMarkdown(TERMS[locale]), `## ${WITHDRAWAL[locale].title}`, legalMarkdown(WITHDRAWAL[locale], 3)].join('\n\n'),
  };
}

const PRIVACY_DE = `Stand: Oktober 2026

Music Hub ist ein Werkzeug für Musikproduktionen: Versionen, Feedback und Freigaben. Ein Konto gibt es per Registrierung, solange Plätze frei sind, oder per Einladung. Hier steht, welche Daten dabei anfallen, wofür ich sie brauche und wo sie liegen. Werbung, Tracking oder Analyse-Dienste gibt es nicht.

## 1. Verantwortlicher

Robin Wahl, Pleasance, Bugginger Straße 37, 79114 Freiburg, E-Mail: hello@pleasance.org

## 2. Hosting

Music Hub läuft auf meinem eigenen Server bei der Hetzner Online GmbH (Industriestr. 25, 91710 Gunzenhausen), Serverstandort ist Nürnberg. Auch die hochgeladenen Dateien liegen bei Hetzner in Nürnberg. Beim Aufruf überträgt dein Browser technisch notwendige Daten wie deine IP-Adresse, den Zeitpunkt und den Browser-Typ. Der Server braucht sie, um die Seiten auszuliefern und Missbrauch zu begrenzen. Für die Begrenzung von Anfragen speichert er deine IP-Adresse in seiner Datenbank und löscht sie spätestens zwei Stunden nach deiner letzten Anfrage. Auch die Schriftarten werden von diesem Server geladen, es besteht keine Verbindung zu Google. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren und zuverlässigen Betrieb).

## 3. Konto und Anmeldung

Für dein Konto speichere ich deinen Namen, deine E-Mail-Adresse, die Sprache für Mails und Benachrichtigungen und, falls du eines festlegst, dein Passwort als Hash. Konten entstehen über eine Registrierung oder eine Einladung, beide bestätigst du über einen Link per E-Mail. Links per E-Mail gelten je nach Zweck zwischen 15 Minuten und sieben Tagen. Nicht genutzte lösche ich, sobald sie abgelaufen sind, genutzte nach 90 Tagen. Nach dem Login setzt Music Hub ein Cookie, das dich angemeldet hält. Die Anmeldung gilt 365 Tage und verlängert sich, solange du Music Hub benutzt, eine abgelaufene lösche ich. Apps wie das DAW-Plugin und die Kommandozeile melden sich über einen Gerätecode an, für sie gilt dasselbe. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Nutzung von Music Hub). Dein Konto bleibt bestehen, bis du um die Löschung bittest.

Außerdem speichere ich, wann du Music Hub zuletzt benutzt hast, auf wenige Minuten genau. Jede Nutzung überschreibt diesen Zeitpunkt, ein Verlauf entsteht dabei nicht. Zusammen mit deinen Logins, Uploads und Kommentaren zeigt er mir als Betreiber, wer gerade online ist und wer schon länger nicht mehr da war. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem Überblick über den Betrieb).

## 4. Projekte, Dateien und Kommentare

Was du in Music Hub hochlädst oder schreibst, also Audiodateien, Spuren, Cover, Kommentare und Freigaben, speichere ich, damit die Mitglieder deines Projekts damit arbeiten können. Sichtbar ist es nur für diese Mitglieder und für alle, denen ihr einen Link schickt. Audiodateien wandelt mein Server für die Wiedergabe um und misst dabei die Lautheit. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Die Inhalte bleiben gespeichert, bis sie im Projekt gelöscht werden. Gelöschtes liegt dann 30 Tage im Papierkorb und lässt sich dort wiederherstellen. Danach, oder sobald es dort endgültig gelöscht wird, bewahre ich es noch höchstens 60 Tage auf, damit ich versehentlich Gelöschtes auf Anfrage wiederherstellen kann, und lösche es dann samt Dateien. Ersetzte Cover und Dateien, die vor der Einführung des Papierkorbs gelöscht wurden, bleiben vorerst im Speicher. Auf Anfrage lösche ich früher.

## 5. Teilen per Link

Wer einen geteilten Link öffnet, braucht kein Konto. Dabei speichere ich den Zeitpunkt, wie lange und ob bis zum Ende gehört wurde, die Kennung deines Browsers, einen gekürzten Hash deiner IP-Adresse statt der Adresse selbst und deinen Namen, falls du ihn angibst. Kommentare speichere ich mit dem Namen, den du dazu angibst. Damit du ihn nicht jedes Mal eintippen musst, merkt sich dein Browser diesen Namen. Wer den Link erstellt hat, sieht diese Angaben als Hör-Statistik und bekommt höchstens einmal pro Stunde eine E-Mail, dass jemand reingehört hat. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse, Feedback zuzuordnen und zu sehen, ob ein Mix angekommen ist). Die Kennung deines Browsers und den Hash deiner IP-Adresse lösche ich nach 90 Tagen, die übrigen Angaben, sobald der Link gelöscht wird oder die Version endgültig gelöscht ist.

## 6. E-Mails

Einladungen, Login-Links, Hör-Benachrichtigungen und Mails zu neuen Versionen und Rückmeldungen verschickt Music Hub von noreply@pleasance.org über Proton (Proton AG, Route de la Galaise 32, 1228 Plan-les-Ouates, Schweiz). Für die Schweiz liegt ein Angemessenheitsbeschluss der EU-Kommission vor (Art. 45 DSGVO). Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Mails zu neuen Versionen und Rückmeldungen bekommst du nur, solange du auf keinem Gerät Push aktiviert hast. Abbestellen kannst du sie in deinem Konto oder über den Link in jeder dieser Mails.

Updates zu neuen Funktionen bekommst du nur, wenn du sie beim Login oder bei der Registrierung ankreuzt und mit dem Link in der Mail bestätigst oder sie in deinem Konto einschaltest. Dafür speichere ich, seit wann du sie bekommst. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Abbestellen kannst du sie jederzeit in deinem Konto oder über den Link in jeder Update-Mail.

## 7. Push-Benachrichtigungen

Benachrichtigungen über neue oder freigegebene Versionen gibt es nur, wenn du sie in deinem Konto aktivierst und im Browser erlaubst. Dafür speichere ich die Push-Adresse deines Browsers, die zugehörigen Schlüssel und die Kennung deines Browsers. Zugestellt werden die Nachrichten verschlüsselt über den Push-Dienst deines Browser-Herstellers, etwa Google, Mozilla oder Apple. Dabei können Daten in die USA übertragen werden. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Du kannst Push jederzeit in deinem Konto oder im Browser abschalten.

## 8. Speicherung auf deinem Gerät

Music Hub legt in deinem Browser nur ab, was für die Funktion nötig ist: das Cookie für die Anmeldung, die Sprache, die du in der Fußzeile wählst, deinen Namen für geteilte Links, ob du die Einführung schon gesehen hast, und Audiodateien, die du ausdrücklich offline speicherst. Ein Service Worker hält die Programmdateien vor, damit Music Hub schnell lädt und sich als App installieren lässt. Rechtsgrundlage ist § 25 Abs. 2 Nr. 2 TDDDG (unbedingt erforderlich).

## 9. Die Demo auf der Startseite

Die Demo auf der Startseite läuft mit Beispieldaten nur in deinem Browser. Was du dort eingibst, wird weder gespeichert noch übertragen.

## 10. Fehlerberichte

Tritt in Music Hub ein Fehler auf, geht ein Bericht an GlitchTip, das auf meinem eigenen Server läuft. Die Berichte enthalten technische Angaben zum Fehler, aber keine Kontodaten, Cookies oder Inhalte von Anfragen. GlitchTip löscht die Berichte nach 90 Tagen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem fehlerfreien Betrieb).

## 11. Datensicherung

Die Datenbank sichere ich jede Nacht verschlüsselt, bei Hetzner in Deutschland und auf eigener Hardware. Sicherungen bewahre ich höchstens zwölf Monate auf.

## 12. Deine Rechte

Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Eine Einwilligung kannst du jederzeit für die Zukunft widerrufen. Wende dich dazu an die oben genannte Kontaktadresse. Außerdem hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, zum Beispiel beim Landesbeauftragten für den Datenschutz und die Informationsfreiheit Baden-Württemberg.`;

const PRIVACY_EN = `Last updated: October 2026. This is a translation, the German version is binding.

Music Hub is a tool for music productions: versions, feedback and approvals. You get an account by signing up, as long as places are free, or by invitation. This page explains which data arises, what I need it for and where it is stored. There is no advertising, tracking or analytics service.

## 1. Controller

Robin Wahl, Pleasance, Bugginger Straße 37, 79114 Freiburg, Email: hello@pleasance.org

## 2. Hosting

Music Hub runs on my own server at Hetzner Online GmbH (Industriestr. 25, 91710 Gunzenhausen, Germany), the server is located in Nuremberg. The uploaded files are also stored at Hetzner in Nuremberg. When you visit, your browser transmits technically necessary data such as your IP address, the time and the browser type. The server needs it to deliver the pages and to limit abuse. To rate-limit requests, it stores your IP address in its database and deletes it two hours after your last request at the latest. The fonts are also loaded from this server, there is no connection to Google. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in secure and reliable operation).

## 3. Account and login

For your account I store your name, your email address, the language for mails and notifications and, if you set one, your password as a hash. Accounts are created by signing up or by invitation, and you confirm both with a link sent by email. Links sent by email are valid between 15 minutes and seven days, depending on their purpose. I delete unused ones once they have expired, used ones after 90 days. After you log in, Music Hub sets a cookie that keeps you logged in. The login is valid for 365 days and extends as long as you use Music Hub, I delete an expired one. Apps such as the DAW plugin and the command line log in with a device code, the same applies to them. The legal basis is Art. 6(1)(b) GDPR (use of Music Hub). Your account stays until you ask for it to be deleted.

I also store when you last used Music Hub, accurate to a few minutes. Every use overwrites this time, no history builds up. Together with your logins, uploads and comments, it shows me as the operator who is online right now and who has not been around for a while. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in an overview of operations).

## 4. Projects, files and comments

What you upload or write in Music Hub, that is audio files, stems, covers, comments and approvals, I store so that the members of your project can work with it. It is visible only to these members and to everyone you send a link to. My server converts audio files for playback and measures their loudness in the process. The legal basis is Art. 6(1)(b) GDPR. The content stays stored until it is deleted in the project. Deleted items then stay in the trash for 30 days and can be restored there. After that, or as soon as they are permanently deleted there, I keep them for at most another 60 days so that I can restore accidentally deleted items on request, and then delete them along with their files. Replaced covers and files that were deleted before the trash was introduced remain in storage for now. On request I delete earlier.

## 5. Sharing by link

Whoever opens a shared link does not need an account. In doing so I store the time, how long and whether the listener heard it to the end, your browser’s identifier, a shortened hash of your IP address instead of the address itself, and your name if you give one. I store comments with the name you give for them. So that you do not have to type it every time, your browser remembers this name. Whoever created the link sees this information as listening statistics and receives at most one email per hour saying that someone listened in. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in attributing feedback and seeing whether a mix has arrived). I delete your browser’s identifier and the hash of your IP address after 90 days, the rest of the information as soon as the link is deleted or the version is permanently deleted.

## 6. Emails

Music Hub sends invitations, login links, listening notifications and emails about new versions and reviews from noreply@pleasance.org via Proton (Proton AG, Route de la Galaise 32, 1228 Plan-les-Ouates, Switzerland). For Switzerland there is an adequacy decision of the EU Commission (Art. 45 GDPR). The legal basis is Art. 6(1)(b) GDPR. You only receive emails about new versions and reviews as long as you have not enabled push on any device. You can unsubscribe in your account or via the link in each of these emails.

You only receive updates about new features if you tick the box when logging in or signing up and confirm with the link in the email, or turn them on in your account. For this I store since when you have been receiving them. The legal basis is your consent (Art. 6(1)(a) GDPR). You can unsubscribe at any time in your account or via the link in each update email.

## 7. Push notifications

Notifications about new or approved versions exist only if you turn them on in your account and allow them in the browser. For this I store your browser’s push address, the associated keys and your browser’s identifier. The messages are delivered encrypted via the push service of your browser’s vendor, such as Google, Mozilla or Apple. Data may be transferred to the USA in the process. The legal basis is your consent (Art. 6(1)(a) GDPR). You can turn push off at any time in your account or in the browser.

## 8. Storage on your device

Music Hub stores in your browser only what is needed for it to work: the cookie for logging in, the language you pick in the footer, your name for shared links, whether you have already seen the introduction, and audio files you explicitly save offline. A service worker keeps the program files so that Music Hub loads quickly and can be installed as an app. The legal basis is § 25(2) no. 2 TDDDG (strictly necessary).

## 9. The demo on the start page

The demo on the start page runs with sample data only in your browser. What you enter there is neither stored nor transmitted.

## 10. Error reports

If an error occurs in Music Hub, a report goes to GlitchTip, which runs on my own server. The reports contain technical details about the error, but no account data, cookies or request contents. GlitchTip deletes the reports after 90 days. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in error-free operation).

## 11. Backups

I back up the database every night, encrypted, at Hetzner in Germany and on my own hardware. I keep backups for at most twelve months.

## 12. Your rights

You have the right of access, rectification, erasure, restriction of processing, data portability and objection. You can withdraw your consent at any time with effect for the future. To do so, contact the address given above. You also have the right to lodge a complaint with a data protection supervisory authority, for example the State Commissioner for Data Protection and Freedom of Information of Baden-Württemberg.`;
