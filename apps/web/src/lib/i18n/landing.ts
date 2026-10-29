// The start page, its demo, the footer and the legal pages
export const de = {
  meta: {
    title: 'Music Hub — Versionen für Musik. Ohne Chaos.',
    description:
      'Music Hub hält jeden Stand deines Songs fest. Feedback sitzt auf der Sekunde, um die es geht, und am Ende ist klar, welcher Mix freigegeben ist. Open Source und selbst hostbar.',
  },
  dashboard: 'Zum Dashboard',
  hero: {
    lede: 'Für Producer, Bands und alle, die am Song arbeiten: Music Hub hält jeden Stand fest, Kommentare sitzen auf der Sekunde, und am Ende ist klar, welcher Mix freigegeben ist.',
    openSource: 'Open Source, selbst hostbar →',
    fine: 'Kostenlos, solange Plätze frei sind. Zum Reinhören reicht ein Link.',
  },
  demo: {
    phoneBar: 'Demo mit Beispieldaten',
    tryIt: 'Ausprobieren',
    phoneTitle: 'Music Hub mit Beispieldaten',
    desktopTitle: 'Music Hub mit Beispieldaten: die Seite eines Tracks',
    tryLabel: "Probier's aus:",
    tryPhone: 'Tipp auf „Ausprobieren“ und kommentier an der Wellenform.',
    tryDesktop: 'Klick in die Wellenform und schreib einen Kommentar.',
    tryNote: 'Das ist die echte Oberfläche mit Beispieldaten, gespeichert wird nichts.',
    elsewhere: 'Das geht oben im Demo-Fenster.',
    approved: (n: number) => `V${n} ist freigegeben`,
    notified: (name: string) => `${name} bekommt Bescheid`,
    typedComment: 'Hi-Hats ab hier etwas leiser?',
  },
  chaos: {
    title: 'Schluss mit Final_v3_REAL.wav',
    body: 'Neue Version hochladen, die alte bleibt daneben. Statt Ordnern und Sprachnachrichten: ein Track, alle Versionen, jede mit Status und offenen Punkten.',
    before: 'Bisher',
    after: 'Mit Music Hub · klick eine Version',
    file1: 'Nachtbus_mix_final.wav',
    file2: 'Nachtbus_mix_final_v2.wav',
    file3: 'Nachtbus_final_v3_REAL.wav',
    file4: 'Nachtbus_final_v3_REAL_2.wav',
    question: 'welcher Link ist jetzt der aktuelle??',
  },
  feedback: {
    title: 'Feedback auf die Sekunde.',
    body: 'Klick in die Wellenform und schreib, was dir auffällt. Der Kommentar hängt an V4 bei 0:42, ein Klick auf den Zeitstempel spielt genau diese Stelle. Was in V2 offen geblieben ist, steht gleich darunter.',
    hint: 'Hak einen Punkt aus V2 als erledigt ab.',
  },
  approval: {
    title: 'Freigeben oder zurück an den Mix.',
    body: 'Wer fertig gehört hat, sagt es mit einem Klick: freigeben, Änderungen nötig oder nur Anmerkungen. Wer hochgeladen hat, bekommt das Urteil und alle Anmerkungen in einer Nachricht.',
    hint: 'Gib V4 frei oder schick sie mit „Fertig mit V4“ zurück an den Mix.',
  },
  audience: {
    title: 'Für alle, die am Song arbeiten.',
    producers: 'Producer und Engineers',
    producersItems: [
      'Mixe per Drag-and-drop hochladen, auch mehrere auf einmal',
      'Spuren pro Track, für den Mix als ZIP',
      'Leertaste spielt, C kommentiert, ← und → wechseln die Version',
    ],
    phoneAlt: 'Der Track Nachtbus am Handy: V4 mit Wellenform, Kommentaren und Knöpfen zum Freigeben',
    band: 'Band, Artists und Kunden',
    bandItems: [
      'Am Handy anhören und kommentieren, als App installierbar',
      'Zum Reinhören reicht ein Link, ganz ohne Account',
      'Freigeben mit einem Tipp',
    ],
  },
  final: {
    title: 'Dein nächster Mix hat ein Zuhause.',
    body: 'Leg ein Projekt an, lad V1 hoch und schick den Link an deine Band.',
    fine: 'Kostenlos, solange Plätze frei sind. Läuft auf Servern in Deutschland.',
  },
  oss: {
    text: 'Music Hub ist Open Source (AGPL-3.0). Mit Docker und einem S3-Bucket läuft er auch auf deinem Server.',
    link: 'Anleitung auf GitHub →',
  },
  siteFooter: {
    product: 'Produkt',
    openSource: 'Open Source',
    repository: 'Repository',
    selfHost: 'Selbst hosten',
    legal: 'Rechtliches',
  },
  imprint: {
    meta: 'Music Hub ist ein Angebot von Pleasance.',
    provider: 'Angaben gemäß § 5 DDG',
    contact: 'Kontakt',
    responsible: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
    userContent: 'Inhalte von Nutzerinnen und Nutzern',
    userContentBefore:
      'Audiodateien, Kommentare und andere Inhalte in den Projekten stammen von deren Mitgliedern und von Gästen mit einem geteilten Link. Wenn dir dort ein rechtswidriger Inhalt auffällt, schreib mir an',
    userContentAfter: ', dann prüfe ich ihn und entferne ihn gegebenenfalls.',
    contentLiability: 'Haftung für Inhalte',
    contentLiabilityText:
      'Die Inhalte dieser Seite wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden.',
    linkLiability: 'Haftung für Links',
    linkLiabilityText:
      'Diese Website enthält Links zu externen Websites Dritter, auf deren Inhalte kein Einfluss besteht. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter verantwortlich.',
  },
  unsubscribe: {
    title: 'Mails abbestellen — Music Hub',
    updatesTitle: 'Updates per Mail',
    updatesDone:
      'Abbestellt. Music Hub schickt dir keine Updates zu neuen Funktionen mehr. Login-Mails kommen weiter, wenn du sie anforderst.',
    resubscribe: 'Doch wieder bestellen',
    updatesAgain: 'Wieder bestellt. Du bekommst wieder Updates zu neuen Funktionen.',
    updatesIdle: 'Du bekommst eine Mail, wenn Music Hub neue Funktionen hat, höchstens ein paar Mal im Monat.',
    updatesError: 'Das hat nicht geklappt. Versuch es noch einmal oder schalte die Updates in deinem Konto aus.',
    unsubscribe: 'Abbestellen',
    noticesTitle: 'Mails zu Versionen und Rückmeldungen',
    noticesDone:
      'Abbestellt. Du bekommst keine Mails zu neuen Versionen und Rückmeldungen mehr. In deinem Konto kannst du sie wieder einschalten.',
    noticesIdle:
      'Du bekommst eine Mail, wenn in deinen Projekten neue Versionen hochgeladen werden oder jemand mit deiner Version fertig ist und du keinen Push aktiviert hast.',
    noticesError: 'Das hat nicht geklappt. Versuch es noch einmal oder schalte die Mails in deinem Konto aus.',
  },
  privacy: {
    title: 'Datenschutz\u00ADerklärung',
    meta: 'Stand: Oktober 2026',
    intro:
      'Music Hub ist ein Werkzeug für Musikproduktionen: Versionen, Feedback und Freigaben. Ein Konto gibt es per Registrierung, solange Plätze frei sind, oder per Einladung. Hier steht, welche Daten dabei anfallen, wofür ich sie brauche und wo sie liegen. Werbung, Tracking oder Analyse-Dienste gibt es nicht.',
    controller: '1. Verantwortlicher',
    sections: [
      [
        '2. Hosting',
        [
          'Music Hub läuft auf meinem eigenen Server bei der Hetzner Online GmbH (Industriestr. 25, 91710 Gunzenhausen), Serverstandort ist Nürnberg. Auch die hochgeladenen Dateien liegen bei Hetzner in Nürnberg. Beim Aufruf überträgt dein Browser technisch notwendige Daten wie deine IP-Adresse, den Zeitpunkt und den Browser-Typ. Der Server braucht sie, um die Seiten auszuliefern und Missbrauch zu begrenzen. Für die Begrenzung von Anfragen hält er deine IP-Adresse kurzzeitig im Arbeitsspeicher. Auch die Schriftarten werden von diesem Server geladen, es besteht keine Verbindung zu Google. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren und zuverlässigen Betrieb).',
        ],
      ],
      [
        '3. Konto und Anmeldung',
        [
          'Für dein Konto speichere ich deinen Namen, deine E-Mail-Adresse, die Sprache für Mails und Benachrichtigungen und, falls du eines festlegst, dein Passwort als Hash. Konten entstehen über eine Registrierung oder eine Einladung, beide bestätigst du über einen Link per E-Mail. Links per E-Mail gelten je nach Zweck zwischen 15 Minuten und sieben Tagen. Nach dem Login setzt Music Hub ein Cookie, das dich angemeldet hält. Die Anmeldung gilt 365 Tage und verlängert sich, solange du Music Hub benutzt. Apps wie das DAW-Plugin und die Kommandozeile melden sich über einen Gerätecode an, für sie gilt dasselbe. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Nutzung von Music Hub). Dein Konto bleibt bestehen, bis du um die Löschung bittest.',
          'Außerdem speichere ich, wann du Music Hub zuletzt benutzt hast, auf wenige Minuten genau. Jede Nutzung überschreibt diesen Zeitpunkt, ein Verlauf entsteht dabei nicht. Zusammen mit deinen Logins, Uploads und Kommentaren zeigt er mir als Betreiber, wer gerade online ist und wer schon länger nicht mehr da war. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem Überblick über den Betrieb).',
        ],
      ],
      [
        '4. Projekte, Dateien und Kommentare',
        [
          'Was du in Music Hub hochlädst oder schreibst, also Audiodateien, Spuren, Cover, Kommentare und Freigaben, speichere ich, damit die Mitglieder deines Projekts damit arbeiten können. Sichtbar ist es nur für diese Mitglieder und für alle, denen ihr einen Link schickt. Audiodateien wandelt mein Server für die Wiedergabe um und misst dabei die Lautheit. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Die Inhalte bleiben gespeichert, bis sie im Projekt gelöscht werden. Gelöschtes liegt dann 30 Tage im Papierkorb und lässt sich dort wiederherstellen. Danach, oder sobald es dort endgültig gelöscht wird, bewahre ich es noch höchstens 60 Tage auf, damit ich versehentlich Gelöschtes auf Anfrage wiederherstellen kann, und lösche es dann samt Dateien. Ersetzte Cover und Dateien, die vor der Einführung des Papierkorbs gelöscht wurden, bleiben vorerst im Speicher. Auf Anfrage lösche ich früher.',
        ],
      ],
      [
        '5. Teilen per Link',
        [
          'Wer einen geteilten Link öffnet, braucht kein Konto. Dabei speichere ich den Zeitpunkt, wie lange und ob bis zum Ende gehört wurde, die Kennung deines Browsers, einen gekürzten Hash deiner IP-Adresse statt der Adresse selbst und deinen Namen, falls du ihn angibst. Kommentare speichere ich mit dem Namen, den du dazu angibst. Damit du ihn nicht jedes Mal eintippen musst, merkt sich dein Browser diesen Namen. Wer den Link erstellt hat, sieht diese Angaben als Hör-Statistik und bekommt höchstens einmal pro Stunde eine E-Mail, dass jemand reingehört hat. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse, Feedback zuzuordnen und zu sehen, ob ein Mix angekommen ist). Die Angaben werden gelöscht, sobald der Link gelöscht wird oder die Version endgültig gelöscht ist.',
        ],
      ],
      [
        '6. E-Mails',
        [
          'Einladungen, Login-Links, Hör-Benachrichtigungen und Mails zu neuen Versionen und Rückmeldungen verschickt Music Hub von noreply@pleasance.org über Proton (Proton AG, Route de la Galaise 32, 1228 Plan-les-Ouates, Schweiz). Für die Schweiz liegt ein Angemessenheitsbeschluss der EU-Kommission vor (Art. 45 DSGVO). Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Mails zu neuen Versionen und Rückmeldungen bekommst du nur, solange du auf keinem Gerät Push aktiviert hast. Abbestellen kannst du sie in deinem Konto oder über den Link in jeder dieser Mails.',
          'Updates zu neuen Funktionen bekommst du nur, wenn du sie beim Login oder bei der Registrierung ankreuzt und mit dem Link in der Mail bestätigst oder sie in deinem Konto einschaltest. Dafür speichere ich, seit wann du sie bekommst. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Abbestellen kannst du sie jederzeit in deinem Konto oder über den Link in jeder Update-Mail.',
        ],
      ],
      [
        '7. Push-Benachrichtigungen',
        [
          'Benachrichtigungen über neue oder freigegebene Versionen gibt es nur, wenn du sie in deinem Konto aktivierst und im Browser erlaubst. Dafür speichere ich die Push-Adresse deines Browsers, die zugehörigen Schlüssel und die Kennung deines Browsers. Zugestellt werden die Nachrichten verschlüsselt über den Push-Dienst deines Browser-Herstellers, etwa Google, Mozilla oder Apple. Dabei können Daten in die USA übertragen werden. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Du kannst Push jederzeit in deinem Konto oder im Browser abschalten.',
        ],
      ],
      [
        '8. Speicherung auf deinem Gerät',
        [
          'Music Hub legt in deinem Browser nur ab, was für die Funktion nötig ist: das Cookie für die Anmeldung, die Sprache, die du in der Fußzeile wählst, deinen Namen für geteilte Links, ob du die Einführung schon gesehen hast, und Audiodateien, die du ausdrücklich offline speicherst. Ein Service Worker hält die Programmdateien vor, damit Music Hub schnell lädt und sich als App installieren lässt. Rechtsgrundlage ist § 25 Abs. 2 Nr. 2 TDDDG (unbedingt erforderlich).',
        ],
      ],
      [
        '9. Die Demo auf der Startseite',
        [
          'Die Demo auf der Startseite läuft mit Beispieldaten nur in deinem Browser. Was du dort eingibst, wird weder gespeichert noch übertragen.',
        ],
      ],
      [
        '10. Fehlerberichte',
        [
          'Tritt in Music Hub ein Fehler auf, geht ein Bericht an GlitchTip, das auf meinem eigenen Server läuft. Die Berichte enthalten technische Angaben zum Fehler, aber keine Kontodaten, Cookies oder Inhalte von Anfragen. GlitchTip löscht die Berichte nach 90 Tagen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem fehlerfreien Betrieb).',
        ],
      ],
      [
        '11. Datensicherung',
        [
          'Die Datenbank sichere ich jede Nacht verschlüsselt, bei Hetzner in Deutschland und auf eigener Hardware. Sicherungen bewahre ich höchstens zwölf Monate auf.',
        ],
      ],
      [
        '12. Deine Rechte',
        [
          'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Eine Einwilligung kannst du jederzeit für die Zukunft widerrufen. Wende dich dazu an die oben genannte Kontaktadresse. Außerdem hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, zum Beispiel beim Landesbeauftragten für den Datenschutz und die Informationsfreiheit Baden-Württemberg.',
        ],
      ],
    ],
  },
  // Sample data of the demo, see lib/demo/backend.ts
  sample: {
    project: 'Nachtbus EP',
    projectDescription: 'Vier Songs aus dem Proberaum.',
    band: 'Fernlicht',
    cellar: 'Live im Keller',
    podcast: 'Podcast-Intro Funkloch',
    nightBus: 'Nachtbus',
    circles: 'Kreise',
    halfMoon: 'Halbmond',
    encore: 'Zugabe',
    fileName: 'Nachtbus',
    v4Label: 'Mix 2 – mehr Bass',
    v4Notes: 'Bass +2 dB, Snare-Hall kürzer, Backings im Refrain breiter',
    v3Notes: 'Wie V2, nur ohne Shaker',
    v3File: 'Nachtbus_Mix1_ohne_Shaker.wav',
    v3Branch: 'Ohne Shaker',
    v2Notes: 'Erster Mix von Lisa',
    v1Notes: 'Bounce aus dem Proberaum',
    comments: {
      c401: 'Insgesamt top. Die Höhen sind mir noch etwas scharf.',
      c402: 'Snare in der Strophe etwas zu laut',
      c403: 'Bass sitzt jetzt richtig gut 👍',
      c404: 'Backings im Refrain noch etwas lauter?',
      c405: 'Mach ich in Mix 3.',
      c406: 'Refrain ist stark. Fürs Radio bitte noch eine Version mit kürzerem Intro.',
      c407: 'Solo-Gitarre könnte breiter sein',
      c301: 'Ohne Shaker atmet der Refrain viel mehr.',
      c302: 'Hier fehlt er mir aber ein bisschen.',
      c201: 'Bass zu dünn, Hangtom klingt hohl',
      c202: 'Hangtom klingt hohl',
      c203: 'Vocals im Refrain sitzen gut',
      c204: 'Outro zu lang, nach zwei Runden ausblenden',
      c101: 'Tempo passt, Groove auch.',
      c102: 'Zweite Strophe noch mal neu singen',
    },
    reviewNote: 'Bass sitzt, die Backings fehlen mir noch.',
    stems: {
      tom: 'Hangtom',
      guitarL: 'Gitarre L',
      guitarR: 'Gitarre R',
      backings: 'Backings',
    },
    credit: (title: string, band: string, people: string, url: string) =>
      `„${title}“ von ${band} (${people}) · CC BY 4.0 · ${url}`,
    notFound: 'Nicht gefunden',
    unavailable: 'In der Demo nicht verfügbar',
  },
};

export const en: typeof de = {
  meta: {
    title: 'Music Hub — Versions for music. Without the chaos.',
    description:
      'Music Hub keeps every version of your song. Feedback sits on the exact second it is about, and in the end it is clear which mix is approved. Open source and self-hostable.',
  },
  dashboard: 'Go to dashboard',
  hero: {
    lede: 'For producers, bands and everyone working on a song: Music Hub keeps every version, comments sit on the exact second, and in the end it is clear which mix is approved.',
    openSource: 'Open source, self-hostable →',
    fine: 'Free while places last. Listening only takes a link.',
  },
  demo: {
    phoneBar: 'Demo with sample data',
    tryIt: 'Try it out',
    phoneTitle: 'Music Hub with sample data',
    desktopTitle: 'Music Hub with sample data: the page of a track',
    tryLabel: 'Try it:',
    tryPhone: 'Tap “Try it out” and comment on the waveform.',
    tryDesktop: 'Click into the waveform and write a comment.',
    tryNote: 'This is the real interface with sample data, nothing is saved.',
    elsewhere: 'That works in the demo window above.',
    approved: (n) => `V${n} is approved`,
    notified: (name) => `${name} will be notified`,
    typedComment: 'Hi-hats a bit quieter from here?',
  },
  chaos: {
    title: 'No more Final_v3_REAL.wav',
    body: 'Upload a new version, the old one stays next to it. Instead of folders and voice messages: one track, all versions, each with its status and open comments.',
    before: 'Before',
    after: 'With Music Hub · click a version',
    file1: 'NightBus_mix_final.wav',
    file2: 'NightBus_mix_final_v2.wav',
    file3: 'NightBus_final_v3_REAL.wav',
    file4: 'NightBus_final_v3_REAL_2.wav',
    question: 'which link is the current one now??',
  },
  feedback: {
    title: 'Feedback to the second.',
    body: 'Click into the waveform and write what you notice. The comment sticks to V4 at 0:42, a click on the timestamp plays exactly that spot. What stayed open in V2 shows right below.',
    hint: 'Check off a point from V2 as done.',
  },
  approval: {
    title: 'Approve or back to the mix.',
    body: 'Whoever has finished listening says so with one click: approve, request changes or just notes. The uploader gets the verdict and all notes in one message.',
    hint: 'Approve V4 or send it back to the mix with “Done with V4”.',
  },
  audience: {
    title: 'For everyone working on the song.',
    producers: 'Producers and engineers',
    producersItems: [
      'Upload mixes by drag and drop, several at once',
      'Stems per track, as a ZIP for the mix',
      'Space plays, C comments, ← and → switch the version',
    ],
    phoneAlt: 'The track Night Bus on a phone: V4 with waveform, comments and buttons to approve',
    band: 'Bands, artists and clients',
    bandItems: [
      'Listen and comment on your phone, installable as an app',
      'Listening only takes a link, no account needed',
      'Approve with one tap',
    ],
  },
  final: {
    title: 'Your next mix has a home.',
    body: 'Create a project, upload V1 and send the link to your band.',
    fine: 'Free while places last. Runs on servers in Germany.',
  },
  oss: {
    text: 'Music Hub is open source (AGPL-3.0). With Docker and an S3 bucket it runs on your own server too.',
    link: 'Instructions on GitHub →',
  },
  siteFooter: {
    product: 'Product',
    openSource: 'Open source',
    repository: 'Repository',
    selfHost: 'Self-hosting',
    legal: 'Legal',
  },
  imprint: {
    meta: 'Music Hub is run by Pleasance.',
    provider: 'Information pursuant to § 5 DDG',
    contact: 'Contact',
    responsible: 'Responsible for content pursuant to § 18 (2) MStV',
    userContent: 'User-generated content',
    userContentBefore:
      'Audio files, comments and other content in the projects come from their members and from guests with a shared link. If you notice unlawful content there, write to me at',
    userContentAfter: ' and I will review it and remove it if necessary.',
    contentLiability: 'Liability for content',
    contentLiabilityText:
      'The content of this site was created with the greatest care. However, no guarantee can be given for the accuracy, completeness and timeliness of the content.',
    linkLiability: 'Liability for links',
    linkLiabilityText:
      'This website contains links to external third-party websites over whose content we have no influence. The respective provider is always responsible for the content of the linked pages.',
  },
  unsubscribe: {
    title: 'Unsubscribe from emails — Music Hub',
    updatesTitle: 'Updates by email',
    updatesDone:
      'Unsubscribed. Music Hub will no longer send you updates about new features. Login emails still arrive when you request them.',
    resubscribe: 'Subscribe again',
    updatesAgain: 'Subscribed again. You will receive updates about new features again.',
    updatesIdle: 'You get an email when Music Hub has new features, at most a few times a month.',
    updatesError: 'That did not work. Try again or turn off the updates in your account.',
    unsubscribe: 'Unsubscribe',
    noticesTitle: 'Emails about versions and reviews',
    noticesDone:
      'Unsubscribed. You will no longer receive emails about new versions and reviews. You can turn them back on in your account.',
    noticesIdle:
      'You get an email when new versions are uploaded in your projects or someone has finished with your version and you have not enabled push.',
    noticesError: 'That did not work. Try again or turn off the emails in your account.',
  },
  privacy: {
    title: 'Privacy policy',
    meta: 'Last updated: October 2026 · This is a translation, the German version is binding.',
    intro:
      'Music Hub is a tool for music productions: versions, feedback and approvals. You get an account by signing up, as long as places are free, or by invitation. This page explains which data arises, what I need it for and where it is stored. There is no advertising, tracking or analytics service.',
    controller: '1. Controller',
    sections: [
      [
        '2. Hosting',
        [
          'Music Hub runs on my own server at Hetzner Online GmbH (Industriestr. 25, 91710 Gunzenhausen, Germany), the server is located in Nuremberg. The uploaded files are also stored at Hetzner in Nuremberg. When you visit, your browser transmits technically necessary data such as your IP address, the time and the browser type. The server needs it to deliver the pages and to limit abuse. To rate-limit requests, it keeps your IP address in memory for a short time. The fonts are also loaded from this server, there is no connection to Google. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in secure and reliable operation).',
        ],
      ],
      [
        '3. Account and login',
        [
          'For your account I store your name, your email address, the language for mails and notifications and, if you set one, your password as a hash. Accounts are created by signing up or by invitation, and you confirm both with a link sent by email. Links sent by email are valid between 15 minutes and seven days, depending on their purpose. After you log in, Music Hub sets a cookie that keeps you logged in. The login is valid for 365 days and extends as long as you use Music Hub. Apps such as the DAW plugin and the command line log in with a device code, the same applies to them. The legal basis is Art. 6(1)(b) GDPR (use of Music Hub). Your account stays until you ask for it to be deleted.',
          'I also store when you last used Music Hub, accurate to a few minutes. Every use overwrites this time, no history builds up. Together with your logins, uploads and comments, it shows me as the operator who is online right now and who has not been around for a while. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in an overview of operations).',
        ],
      ],
      [
        '4. Projects, files and comments',
        [
          'What you upload or write in Music Hub, that is audio files, stems, covers, comments and approvals, I store so that the members of your project can work with it. It is visible only to these members and to everyone you send a link to. My server converts audio files for playback and measures their loudness in the process. The legal basis is Art. 6(1)(b) GDPR. The content stays stored until it is deleted in the project. Deleted items then stay in the trash for 30 days and can be restored there. After that, or as soon as they are permanently deleted there, I keep them for at most another 60 days so that I can restore accidentally deleted items on request, and then delete them along with their files. Replaced covers and files that were deleted before the trash was introduced remain in storage for now. On request I delete earlier.',
        ],
      ],
      [
        '5. Sharing by link',
        [
          'Whoever opens a shared link does not need an account. In doing so I store the time, how long and whether the listener heard it to the end, your browser’s identifier, a shortened hash of your IP address instead of the address itself, and your name if you give one. I store comments with the name you give for them. So that you do not have to type it every time, your browser remembers this name. Whoever created the link sees this information as listening statistics and receives at most one email per hour saying that someone listened in. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in attributing feedback and seeing whether a mix has arrived). The information is deleted as soon as the link is deleted or the version is permanently deleted.',
        ],
      ],
      [
        '6. Emails',
        [
          'Music Hub sends invitations, login links, listening notifications and emails about new versions and reviews from noreply@pleasance.org via Proton (Proton AG, Route de la Galaise 32, 1228 Plan-les-Ouates, Switzerland). For Switzerland there is an adequacy decision of the EU Commission (Art. 45 GDPR). The legal basis is Art. 6(1)(b) GDPR. You only receive emails about new versions and reviews as long as you have not enabled push on any device. You can unsubscribe in your account or via the link in each of these emails.',
          'You only receive updates about new features if you tick the box when logging in or signing up and confirm with the link in the email, or turn them on in your account. For this I store since when you have been receiving them. The legal basis is your consent (Art. 6(1)(a) GDPR). You can unsubscribe at any time in your account or via the link in each update email.',
        ],
      ],
      [
        '7. Push notifications',
        [
          'Notifications about new or approved versions exist only if you turn them on in your account and allow them in the browser. For this I store your browser’s push address, the associated keys and your browser’s identifier. The messages are delivered encrypted via the push service of your browser’s vendor, such as Google, Mozilla or Apple. Data may be transferred to the USA in the process. The legal basis is your consent (Art. 6(1)(a) GDPR). You can turn push off at any time in your account or in the browser.',
        ],
      ],
      [
        '8. Storage on your device',
        [
          'Music Hub stores in your browser only what is needed for it to work: the cookie for logging in, the language you pick in the footer, your name for shared links, whether you have already seen the introduction, and audio files you explicitly save offline. A service worker keeps the program files so that Music Hub loads quickly and can be installed as an app. The legal basis is § 25(2) no. 2 TDDDG (strictly necessary).',
        ],
      ],
      [
        '9. The demo on the start page',
        [
          'The demo on the start page runs with sample data only in your browser. What you enter there is neither stored nor transmitted.',
        ],
      ],
      [
        '10. Error reports',
        [
          'If an error occurs in Music Hub, a report goes to GlitchTip, which runs on my own server. The reports contain technical details about the error, but no account data, cookies or request contents. GlitchTip deletes the reports after 90 days. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in error-free operation).',
        ],
      ],
      [
        '11. Backups',
        [
          'I back up the database every night, encrypted, at Hetzner in Germany and on my own hardware. I keep backups for at most twelve months.',
        ],
      ],
      [
        '12. Your rights',
        [
          'You have the right of access, rectification, erasure, restriction of processing, data portability and objection. You can withdraw your consent at any time with effect for the future. To do so, contact the address given above. You also have the right to lodge a complaint with a data protection supervisory authority, for example the State Commissioner for Data Protection and Freedom of Information of Baden-Württemberg.',
        ],
      ],
    ],
  },
  sample: {
    project: 'Night Bus EP',
    projectDescription: 'Four songs from the rehearsal room.',
    band: 'Fernlicht',
    cellar: 'Live in the Cellar',
    podcast: 'Podcast intro Dead Zone',
    nightBus: 'Night Bus',
    circles: 'Circles',
    halfMoon: 'Half Moon',
    encore: 'Encore',
    fileName: 'NightBus',
    v4Label: 'Mix 2 – more bass',
    v4Notes: 'Bass +2 dB, shorter snare reverb, wider backing vocals in the chorus',
    v3Notes: 'Like V2, just without the shaker',
    v3File: 'NightBus_Mix1_no_shaker.wav',
    v3Branch: 'No shaker',
    v2Notes: 'First mix by Lisa',
    v1Notes: 'Bounce from the rehearsal room',
    comments: {
      c401: 'Great overall. The highs are still a bit harsh for me.',
      c402: 'Snare in the verse is a bit too loud',
      c403: 'Bass sits really well now 👍',
      c404: 'Backing vocals in the chorus a bit louder?',
      c405: 'Will do in Mix 3.',
      c406: 'Chorus is strong. For radio, please add a version with a shorter intro.',
      c407: 'Solo guitar could be wider',
      c301: 'Without the shaker the chorus breathes so much more.',
      c302: 'I do miss it a little here, though.',
      c201: 'Bass too thin, rack tom sounds hollow',
      c202: 'Rack tom sounds hollow',
      c203: 'Vocals in the chorus sit well',
      c204: 'Outro too long, fade out after two rounds',
      c101: 'Tempo is right, so is the groove.',
      c102: 'Re-sing the second verse',
    },
    reviewNote: 'Bass sits well, I still miss the backing vocals.',
    stems: {
      tom: 'Rack Tom',
      guitarL: 'Guitar L',
      guitarR: 'Guitar R',
      backings: 'Backing Vocals',
    },
    credit: (title, band, people, url) => `“${title}” by ${band} (${people}) · CC BY 4.0 · ${url}`,
    notFound: 'Not found',
    unavailable: 'Not available in the demo',
  },
};
