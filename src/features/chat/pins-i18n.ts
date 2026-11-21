import i18n from "../../lib/i18n";

i18n.addResourceBundle(
  "de",
  "chat",
  {
    pinRoom: "{{title}} anheften",
    unpinRoom: "{{title}} lösen",
    movePinUp: "{{title}} nach oben verschieben",
    movePinDown: "{{title}} nach unten verschieben",
    pinError:
      "Die Änderung konnte nicht bestätigt werden. Bitte versuche es erneut.",
  },
  true,
  true,
);
i18n.addResourceBundle(
  "en",
  "chat",
  {
    pinRoom: "Pin {{title}}",
    unpinRoom: "Unpin {{title}}",
    movePinUp: "Move {{title}} up",
    movePinDown: "Move {{title}} down",
    pinError: "The change could not be confirmed. Please try again.",
  },
  true,
  true,
);
