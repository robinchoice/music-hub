import type { Locale } from './i18n.js';

// The terms for plans (/agb), the cancellation notice and the privacy section about payments.
// One source for the web page, the Markdown for agents and the confirmation mail. They go public only
// once Stripe or BTCPay is set up (lib/billing.ts in the API), see README „Tarife“.

// items are numbered, unless unordered
export type LegalSection = { title: string; paragraphs?: string[]; items?: string[]; unordered?: boolean };
export type LegalText = { title: string; meta: string; sections: LegalSection[] };

const OPERATOR = 'Robin Wahl, Pleasance, Bugginger Straße 37, 79114 Freiburg';

export const TERMS: Record<Locale, LegalText> = {
  de: {
    title: 'Allgemeine Geschäfts­bedingungen',
    meta: 'Stand: Oktober 2026',
    sections: [
      {
        title: '§ 1 Anbieter und Geltung',
        items: [
          `Anbieter von Music Hub ist ${OPERATOR}, hello@pleasance.org („wir“).`,
          'Diese Bedingungen gelten für die Nutzung von Music Hub, gratis oder mit einem bezahlten Tarif, durch Verbraucher und Unternehmer („du“). Abweichende Bedingungen gelten nicht.',
        ],
      },
      {
        title: '§ 2 Was Music Hub ist',
        items: [
          'Music Hub ist ein Werkzeug für Musikproduktionen: Projekte, Tracks, Versionen, Spuren, Kommentare, Freigaben und Links zum Reinhören, im Browser, im DAW-Plugin und auf der Kommandozeile.',
          'Die Dateien liegen bei der Hetzner Online GmbH in Deutschland.',
          'Music Hub ist freie Software. Die Lizenz des Quelltexts gilt unabhängig von diesem Vertrag.',
        ],
      },
      {
        title: '§ 3 Tarife',
        items: [
          'Gratis: alle Funktionen außer Aufträgen, mit 5 GB Speicher für neue Konten. Bestehende Konten behalten ihre bisherige Grenze. Einen Anspruch auf ein kostenloses Konto gibt es nicht; neue kostenlose Konten gibt es, solange Plätze frei sind, oder per Einladung.',
          'Pro: wie Gratis, mit 100 GB Speicher.',
          'Studio: wie Pro, mit 500 GB Speicher und Aufträgen (§ 8).',
          'Mitglieder deiner Projekte und Gäste deiner Links brauchen keinen bezahlten Tarif.',
          'Zum Speicher zählen die Originale, die du hochlädst oder Gäste über deine Upload-Links hochladen, samt früherer Fassungen von Spuren und Dateien im Papierkorb. Daraus erzeugte MP3s, Wellenformen und Cover zählen nicht.',
          'Wir bemühen uns um eine ständige Verfügbarkeit, sichern aber keine bestimmte zu. Wartungen legen wir möglichst in ruhige Zeiten.',
        ],
      },
      {
        title: '§ 4 Vertragsschluss',
        items: [
          'Den Nutzungsvertrag schließt du mit der Registrierung oder der Annahme einer Einladung.',
          'Einen bezahlten Tarif bestellst du im Konto unter „Tarif“. Der Vertrag kommt zustande, wenn du die Bestellung bei Stripe abschließt oder die Lightning-Rechnung bezahlst. Danach bekommst du eine Bestätigung per E-Mail mit diesen Bedingungen und der Widerrufsbelehrung.',
        ],
      },
      {
        title: '§ 5 Preise und Zahlung',
        items: [
          'Pro kostet 9 € im Monat oder 90 € im Jahr, Studio 24 € im Monat oder 240 € im Jahr. Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
          'Karte, PayPal oder SEPA (über Stripe): Du zahlst im Voraus für den Monat bzw. das Jahr. Das Abo verlängert sich automatisch, bis du kündigst. Belege schickt Stripe per E-Mail.',
          'Lightning (über unseren BTCPay Server): Du zahlst im Voraus für einen Monat oder ein Jahr, ohne Abo. Der Betrag in Satoshi ergibt sich aus dem Euro-Preis zum Kurs bei Erstellung der Rechnung. Eine weitere Zahlung schließt an das Ende der bezahlten Zeit an.',
          'Schlägt eine Abbuchung fehl, versucht Stripe es einige Tage lang erneut. Bleibt sie aus, endet der Tarif drei Tage nach dem Ende der bezahlten Zeit.',
          'Preisänderungen kündigen wir mindestens sechs Wochen vorher per E-Mail an. Sie gelten erst ab dem nächsten Abrechnungszeitraum, und du kannst bis dahin kündigen.',
        ],
      },
      {
        title: '§ 6 Laufzeit, Kündigung, Ende eines Tarifs',
        items: [
          'Monatsabo: jederzeit zum Ende des bezahlten Monats kündbar.',
          'Jahresabo: verlängert sich um ein Jahr, wenn du nicht bis zum Ende der Laufzeit kündigst. Nach der ersten Verlängerung kannst du jederzeit mit einer Frist von einem Monat kündigen. Zu viel Gezahltes erstatten wir anteilig.',
          'Lightning: endet mit der bezahlten Zeit, ohne dass du kündigen musst.',
          'Kündigen kannst du im Konto über „Verträge hier kündigen“ oder per E-Mail an hello@pleasance.org.',
          'Endet ein Tarif, löschen wir nichts. Dein Speicher fällt auf deine bisherige Grenze zurück. Liegt mehr darin, kannst du weiter alles anhören, kommentieren, teilen und herunterladen, nur neue Uploads passen erst wieder, wenn Platz ist. Laufende Aufträge laufen zu Ende, neue kannst du nicht mehr anlegen.',
          'Dein Konto kannst du jederzeit löschen lassen, eine E-Mail genügt. Was dann mit deinen Daten geschieht, steht in der Datenschutzerklärung. Vorher kannst du deine Originale herunterladen.',
          'Das Recht zur fristlosen Kündigung aus wichtigem Grund bleibt für beide Seiten unberührt. Kündigen wir aus wichtigem Grund, den du nicht zu vertreten hast, erstatten wir den bezahlten Rest.',
        ],
      },
      {
        title: '§ 7 Deine Inhalte',
        items: [
          'Deine Musik bleibt deine. Du räumst uns nur die Rechte ein, die wir brauchen, um Music Hub für dich zu betreiben: deine Dateien zu speichern und zu sichern, für die Wiedergabe umzuwandeln, Lautheit, Tempo und Tonart zu messen und sie den Menschen zu zeigen, mit denen du sie teilst oder die du in ein Projekt einlädst. Stellst du einen Track unter „Offen“, gilt zusätzlich die Lizenz, die du dort wählst.',
          'Du lädst nur hoch, woran du die nötigen Rechte hast, und nichts Rechtswidriges. Für die Inhalte eines Projekts sind seine Mitglieder verantwortlich, nicht wir.',
          'Hinweise auf rechtswidrige Inhalte nehmen wir über „Melden“ bei offenen Tracks oder per E-Mail an hello@pleasance.org entgegen. Bei einem begründeten Hinweis dürfen wir den Inhalt sperren. Wir sagen dir Bescheid und geben dir Gelegenheit zur Stellungnahme.',
          'Wichtige Dateien sicherst du zusätzlich selbst. Unsere Backups ersetzen das nicht.',
        ],
      },
      {
        title: '§ 8 Aufträge (Studio)',
        items: [
          'Mit einem Auftrag bietest du deinem Kunden über deinen Link zum Reinhören Songs zur Freigabe an, mit Korrekturrunden und einer Bezahlwand.',
          'Der Vertrag über die Produktion besteht nur zwischen dir und deinem Kunden. Wir sind nicht Vertragspartei, nehmen kein Geld entgegen und sind kein Zahlungsdienst: Dein Kunde zahlt per Lightning an deine eigene Wallet oder per Überweisung an dein Konto. Preise, Rechnungen, Steuern, Rückzahlungen und die Rechte an der Musik regelst du mit deinem Kunden.',
          'Die Daten deiner Kunden (Name, E-Mail, Kommentare, Freigaben) verarbeiten wir in deinem Auftrag. Bist du Unternehmer, schließen wir dafür auf Wunsch einen Vertrag zur Auftragsverarbeitung.',
          'Die Verbindung zu deiner Wallet speichern wir verschlüsselt und nur mit dem Recht, Rechnungen zu erstellen und abzufragen, nie zu zahlen.',
        ],
      },
      {
        title: '§ 9 Gewährleistung',
        paragraphs: ['Es gelten die gesetzlichen Mängelrechte, für Verbraucher die §§ 327 ff. BGB. Updates, die zum Erhalt der Vertragsmäßigkeit nötig sind, spielen wir laufend ein.'],
      },
      {
        title: '§ 10 Haftung',
        items: [
          'Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit, nach dem Produkthaftungsgesetz und soweit wir eine Garantie übernommen haben.',
          'Bei leichter Fahrlässigkeit haften wir nur für die Verletzung wesentlicher Vertragspflichten, also solcher, deren Erfüllung den Vertrag erst möglich macht und auf die du regelmäßig vertrauen darfst, und nur bis zur Höhe des vertragstypischen, vorhersehbaren Schadens.',
          'Bei Datenverlust haften wir im Rahmen von Abs. 2 nur für den Aufwand, die Daten aus unseren Backups oder deinen eigenen Sicherungen wiederherzustellen.',
          'Für Zahlungen zwischen dir und deinen Kunden (§ 8) haften wir nicht, soweit der Fehler nicht bei uns liegt.',
        ],
      },
      {
        title: '§ 11 Änderungen',
        items: [
          'Funktionen des Gratis-Tarifs dürfen wir aus triftigem Grund ändern, etwa wegen Sicherheit, Kosten oder rechtlicher Vorgaben. Wesentliche Änderungen kündigen wir vier Wochen vorher an. Gespeicherte Daten verlierst du dadurch nie.',
          'Änderungen dieser Bedingungen gelten für bezahlte Tarife nur, wenn du ihnen zustimmst.',
        ],
      },
      {
        title: '§ 12 Schlussbestimmungen',
        items: [
          'Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Für Verbraucher gilt das nur, soweit nicht zwingende Vorschriften des Staates ihres gewöhnlichen Aufenthalts entgegenstehen.',
          'Für Kaufleute ist Gerichtsstand Freiburg im Breisgau.',
          'Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
        ],
      },
    ],
  },
  en: {
    title: 'Terms and conditions',
    meta: 'Last updated: October 2026 · This is a translation, the German version is binding.',
    sections: [
      {
        title: '§ 1 Provider and scope',
        items: [
          `Music Hub is provided by ${OPERATOR}, Germany, hello@pleasance.org ("we").`,
          'These terms apply to the use of Music Hub, free or with a paid plan, by consumers and businesses ("you"). Other terms do not apply.',
        ],
      },
      {
        title: '§ 2 What Music Hub is',
        items: [
          'Music Hub is a tool for music productions: projects, tracks, versions, stems, comments, approvals and listening links, in the browser, in the DAW plugin and on the command line.',
          'The files are stored at Hetzner Online GmbH in Germany.',
          'Music Hub is free software. The licence of its source code applies independently of this contract.',
        ],
      },
      {
        title: '§ 3 Plans',
        items: [
          'Free: every feature except orders, with 5 GB of storage for new accounts. Existing accounts keep their previous limit. There is no right to a free account; new free accounts exist as long as places are free, or by invitation.',
          'Pro: like Free, with 100 GB of storage.',
          'Studio: like Pro, with 500 GB of storage and orders (§ 8).',
          'Members of your projects and guests of your links need no paid plan.',
          'Storage counts the originals you upload or guests upload through your upload links, including earlier versions of stems and files in the trash. MP3s, waveforms and covers made from them do not count.',
          'We strive for constant availability but do not guarantee any particular level. We schedule maintenance for quiet times where possible.',
        ],
      },
      {
        title: '§ 4 Conclusion of the contract',
        items: [
          'You conclude the contract of use by signing up or accepting an invitation.',
          'You order a paid plan in your account under "Plan". The contract is concluded when you complete the order at Stripe or pay the Lightning invoice. You then receive a confirmation by email with these terms and the cancellation notice.',
        ],
      },
      {
        title: '§ 5 Prices and payment',
        items: [
          'Pro costs €9 a month or €90 a year, Studio €24 a month or €240 a year. No VAT is charged under the small business rule of § 19 UStG.',
          'Card, PayPal or SEPA (via Stripe): you pay in advance for the month or year. The subscription renews automatically until you cancel. Stripe sends receipts by email.',
          'Lightning (via our BTCPay Server): you pay in advance for a month or a year, without a subscription. The amount in satoshis follows from the euro price at the rate when the invoice is created. A further payment starts where the paid time ends.',
          'If a charge fails, Stripe retries it for a few days. If it does not come through, the plan ends three days after the end of the paid time.',
          'We announce price changes by email at least six weeks in advance. They apply from the next billing period only, and you can cancel before then.',
        ],
      },
      {
        title: '§ 6 Term, cancellation, end of a plan',
        items: [
          'Monthly subscription: can be cancelled at any time to the end of the paid month.',
          'Yearly subscription: renews for a year unless you cancel by the end of the term. After the first renewal you can cancel at any time with one month’s notice. We refund overpayments pro rata.',
          'Lightning: ends with the paid time without you having to cancel.',
          'You can cancel in your account under "Cancel contracts here" or by email to hello@pleasance.org.',
          'When a plan ends, we delete nothing. Your storage falls back to your previous limit. If more is stored, you can still listen to, comment on, share and download everything, only new uploads fit again once there is room. Running orders run to their end, you cannot create new ones.',
          'You can have your account deleted at any time, an email is enough. What then happens to your data is in the privacy policy. Before that you can download your originals.',
          'The right of both sides to terminate without notice for good cause remains unaffected. If we terminate for good cause that is not your fault, we refund the paid remainder.',
        ],
      },
      {
        title: '§ 7 Your content',
        items: [
          'Your music stays yours. You grant us only the rights we need to run Music Hub for you: to store and back up your files, convert them for playback, measure loudness, tempo and key, and show them to the people you share them with or invite to a project. If you put a track under "Open", the licence you choose there applies as well.',
          'You only upload what you hold the necessary rights to, and nothing unlawful. The members of a project are responsible for its content, not us.',
          'We take notices of unlawful content via "Report" on open tracks or by email to hello@pleasance.org. On a substantiated notice we may block the content. We let you know and give you the opportunity to respond.',
          'Back up important files yourself as well. Our backups do not replace that.',
        ],
      },
      {
        title: '§ 8 Orders (Studio)',
        items: [
          'With an order you offer your client songs for approval through your listening link, with correction rounds and a paywall.',
          'The contract about the production exists only between you and your client. We are not a party to it, accept no money and are not a payment service: your client pays by Lightning to your own wallet or by bank transfer to your account. You settle prices, invoices, taxes, refunds and the rights to the music with your client.',
          'We process your clients’ data (name, email, comments, approvals) on your behalf. If you are a business, we conclude a data processing agreement for this on request.',
          'We store the connection to your wallet encrypted and only with the right to create and look up invoices, never to pay.',
        ],
      },
      {
        title: '§ 9 Warranty',
        paragraphs: ['The statutory rights for defects apply, for consumers §§ 327 et seq. BGB. We continuously install updates needed to keep the service in conformity with the contract.'],
      },
      {
        title: '§ 10 Liability',
        items: [
          'We are liable without limitation for intent and gross negligence, for injury to life, body or health, under the Product Liability Act and insofar as we have given a guarantee.',
          'For slight negligence we are liable only for breaches of essential contractual obligations, that is those whose fulfilment makes the contract possible in the first place and on which you may regularly rely, and only up to the typical, foreseeable damage.',
          'For loss of data we are liable within paragraph 2 only for the effort of restoring the data from our backups or your own.',
          'We are not liable for payments between you and your clients (§ 8) unless the fault lies with us.',
        ],
      },
      {
        title: '§ 11 Changes',
        items: [
          'We may change features of the Free plan for a valid reason, such as security, costs or legal requirements. We announce significant changes four weeks in advance. You never lose stored data through them.',
          'Changes to these terms apply to paid plans only if you agree to them.',
        ],
      },
      {
        title: '§ 12 Final provisions',
        items: [
          'German law applies, excluding the UN Convention on Contracts for the International Sale of Goods. For consumers this applies only insofar as mandatory provisions of the country of their habitual residence do not prevail.',
          'For merchants the place of jurisdiction is Freiburg im Breisgau.',
          'We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.',
        ],
      },
    ],
  },
};

// The statutory model (Annex 1 to Art. 246a § 1(2) EGBGB), word for word, hence the formal address
export const WITHDRAWAL: Record<Locale, LegalText> = {
  de: {
    title: 'Widerrufsbelehrung',
    meta: '',
    sections: [
      {
        title: 'Widerrufsrecht',
        paragraphs: [
          'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.',
          'Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.',
          `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${OPERATOR}, E-Mail: hello@pleasance.org) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. Sie können den Vertrag auch im Konto unter „Tarif“ mit „Vertrag widerrufen“ widerrufen.`,
          'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.',
        ],
      },
      {
        title: 'Folgen des Widerrufs',
        paragraphs: [
          'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.',
          'Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.',
        ],
      },
      {
        title: 'Muster-Widerrufsformular',
        unordered: true,
        paragraphs: ['(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)'],
        items: [
          `An ${OPERATOR}, E-Mail: hello@pleasance.org:`,
          'Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*)',
          'Bestellt am (*)/erhalten am (*)',
          'Name des/der Verbraucher(s)',
          'Anschrift des/der Verbraucher(s)',
          'Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)',
          'Datum',
          '(*) Unzutreffendes streichen.',
        ],
      },
    ],
  },
  en: {
    title: 'Cancellation notice',
    meta: '',
    sections: [
      {
        title: 'Right of withdrawal',
        paragraphs: [
          'You have the right to withdraw from this contract within 14 days without giving any reason.',
          'The withdrawal period will expire after 14 days from the day of the conclusion of the contract.',
          `To exercise the right of withdrawal, you must inform us (${OPERATOR}, Germany, email: hello@pleasance.org) of your decision to withdraw from this contract by an unequivocal statement (e.g. a letter sent by post or email). You may use the attached model withdrawal form, but it is not obligatory. You can also withdraw in your account under "Plan" with "Withdraw from contract".`,
          'To meet the withdrawal deadline, it is sufficient for you to send your communication concerning your exercise of the right of withdrawal before the withdrawal period has expired.',
        ],
      },
      {
        title: 'Effects of withdrawal',
        paragraphs: [
          'If you withdraw from this contract, we shall reimburse to you all payments received from you, including the costs of delivery (with the exception of the supplementary costs resulting from your choice of a type of delivery other than the least expensive type of standard delivery offered by us), without undue delay and in any event not later than 14 days from the day on which we are informed about your decision to withdraw from this contract. We will carry out such reimbursement using the same means of payment as you used for the initial transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result of such reimbursement.',
          'If you requested to begin the performance of services during the withdrawal period, you shall pay us an amount which is in proportion to what has been provided until you have communicated us your withdrawal from this contract, in comparison with the full coverage of the contract.',
        ],
      },
      {
        title: 'Model withdrawal form',
        unordered: true,
        paragraphs: ['(Complete and return this form only if you wish to withdraw from the contract.)'],
        items: [
          `To ${OPERATOR}, Germany, email: hello@pleasance.org:`,
          'I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract of sale of the following goods (*)/for the provision of the following service (*)',
          'Ordered on (*)/received on (*)',
          'Name of consumer(s)',
          'Address of consumer(s)',
          'Signature of consumer(s) (only if this form is notified on paper)',
          'Date',
          '(*) Delete as appropriate.',
        ],
      },
    ],
  },
};

// The express request before buying, so a withdrawal costs only the time used (§ 357a(2) BGB)
export const PLAN_CONSENT: Record<Locale, string> = {
  de: 'Ich verlange ausdrücklich, dass mein Tarif sofort beginnt. Mir ist bekannt, dass ich bei einem Widerruf für die Zeit bis dahin anteilig zahle. Es gelten die AGB und die Datenschutzerklärung.',
  en: 'I expressly request that my plan starts right away. I understand that if I withdraw, I pay pro rata for the time until then. The terms and the privacy policy apply.',
};

// Appended to the privacy policy while plans can be bought, after its last numbered section
export const PRIVACY_PAYMENTS: Record<Locale, LegalSection> = {
  de: {
    title: '13. Tarife und Zahlungen',
    paragraphs: [
      'Wenn du Pro oder Studio bezahlst, speichere ich deinen Tarif, bis wann er bezahlt ist, und zu jeder Zahlung die Zahlungsart, die Kennung der Rechnung beim Zahlungsdienst, den Betrag, den Status, die Zeitpunkte, deine Zustimmung zum sofortigen Beginn und einen Widerruf. Kartendaten, Kontonummern oder Wallets sehe ich nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Vertrag über den Tarif). Die Angaben zu Zahlungen bewahre ich acht Jahre auf, weil das Handels- und Steuerrecht es verlangt (Art. 6 Abs. 1 lit. c DSGVO, § 147 AO, § 257 HGB), auch wenn du dein Konto vorher löschst. Dann bleiben sie ohne Verbindung zu deinem Konto stehen.',
      'Karte, PayPal oder SEPA: Die Zahlung wickelt Stripe ab (Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin 2, Irland). Stripe bekommt deine E-Mail-Adresse und die Zahlungsdaten, die du dort eingibst, und schickt dir Belege. Bei mir liegen nur deine Kundennummer und die Nummer deines Abos bei Stripe. Für Betrugsprävention und gesetzliche Pflichten ist Stripe selbst verantwortlich. Dabei können Daten an die Stripe, Inc. in die USA gehen; sie ist nach dem EU-US Data Privacy Framework zertifiziert. Zahlst du mit PayPal, ist zusätzlich PayPal (Europe) S.à r.l. et Cie, S.C.A., 22–24 Boulevard Royal, 2449 Luxemburg, beteiligt. Es gelten auch deren Datenschutzerklärungen.',
      'Lightning: Die Rechnung erstellt ein BTCPay Server, den ich selbst betreibe. Er kennt nur Betrag, Tarif und Status der Rechnung, keine Namen. Eine Lightning-Zahlung erscheint nicht öffentlich. Zahlst du über die Bitcoin-Blockchain statt über Lightning, ist die Transaktion dort dauerhaft öffentlich sichtbar, ohne deinen Namen.',
    ],
  },
  en: {
    title: '13. Plans and payments',
    paragraphs: [
      'When you pay for Pro or Studio, I store your plan, until when it is paid, and for each payment the payment method, the invoice ID at the payment service, the amount, the status, the times, your consent to the immediate start and any withdrawal. I do not see card details, account numbers or wallets. The legal basis is Art. 6(1)(b) GDPR (contract for the plan). I keep the payment records for eight years because commercial and tax law requires it (Art. 6(1)(c) GDPR, § 147 AO, § 257 HGB), even if you delete your account earlier. They then remain without any link to your account.',
      'Card, PayPal or SEPA: Stripe processes the payment (Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin 2, Ireland). Stripe receives your email address and the payment details you enter there, and sends you receipts. I only hold your customer number and the number of your subscription at Stripe. Stripe is itself responsible for fraud prevention and legal obligations. Data may be transferred to Stripe, Inc. in the USA in the process; it is certified under the EU-US Data Privacy Framework. If you pay with PayPal, PayPal (Europe) S.à r.l. et Cie, S.C.A., 22–24 Boulevard Royal, 2449 Luxembourg, is involved as well. Their privacy policies also apply.',
      'Lightning: the invoice is created by a BTCPay Server that I run myself. It only knows the amount, plan and status of the invoice, no names. A Lightning payment is not public. If you pay on the Bitcoin blockchain instead of over Lightning, the transaction is permanently public there, without your name.',
    ],
  },
};

// Markdown for agents (public-pages.ts) and the plain text of the confirmation mail
export function legalMarkdown(text: LegalText, level = 2): string {
  const h = '#'.repeat(level);
  return text.sections
    .map((s) =>
      [
        `${h} ${s.title}`,
        ...(s.paragraphs ?? []),
        ...(s.items?.length ? [s.items.map((item, i) => `${s.unordered ? '-' : `${i + 1}.`} ${item}`).join('\n')] : []),
      ].join('\n\n'),
    )
    .join('\n\n');
}
