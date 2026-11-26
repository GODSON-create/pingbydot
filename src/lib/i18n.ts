/**
 * PING Continental & Global Localisation + Low-Bandwidth Data Saver (Phase 5.4)
 *
 * Ships first-class African & global locale support (English, French, Swahili,
 * Hausa, Yorùbá, Arabic with RTL document direction), regional currency/date formatting,
 * and mobile Data Saver preferences.
 */

import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SupportedLocale = "en" | "fr" | "sw" | "ha" | "yo" | "ar";

export interface LocaleMeta {
  code: SupportedLocale;
  name: string;
  nativeName: string;
  regionHint: string;
  dir: "ltr" | "rtl";
  defaultCurrency: string;
}

export const SUPPORTED_LOCALES: readonly LocaleMeta[] = [
  {
    code: "en",
    name: "English",
    nativeName: "English",
    regionHint: "Global / Pan-African",
    dir: "ltr",
    defaultCurrency: "USD",
  },
  {
    code: "fr",
    name: "French",
    nativeName: "Français",
    regionHint: "West & Central Africa / Global",
    dir: "ltr",
    defaultCurrency: "XOF",
  },
  {
    code: "sw",
    name: "Swahili",
    nativeName: "Kiswahili",
    regionHint: "East Africa (KE, TZ, UG, RW)",
    dir: "ltr",
    defaultCurrency: "KES",
  },
  {
    code: "ha",
    name: "Hausa",
    nativeName: "Hausa",
    regionHint: "West Africa (NG, NE, GH)",
    dir: "ltr",
    defaultCurrency: "NGN",
  },
  {
    code: "yo",
    name: "Yoruba",
    nativeName: "Yorùbá",
    regionHint: "West Africa (NG, BJ, TG)",
    dir: "ltr",
    defaultCurrency: "NGN",
  },
  {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    regionHint: "North Africa & MENA (EG, MA, TN)",
    dir: "rtl",
    defaultCurrency: "EGP",
  },
] as const;

export const SUPPORTED_CURRENCIES = [
  "NGN",
  "KES",
  "GHS",
  "ZAR",
  "XOF",
  "EGP",
  "MAD",
  "USD",
  "EUR",
  "GBP",
] as const;

export type TranslationKey =
  | "nav.home"
  | "nav.explore"
  | "nav.create"
  | "nav.hubs"
  | "nav.inbox"
  | "nav.griot"
  | "nav.developers"
  | "nav.business"
  | "nav.settings"
  | "offline.banner"
  | "offline.queue_pending"
  | "offline.sync_now"
  | "griot.title"
  | "griot.privacy_badge"
  | "dev.title"
  | "settings.language_title"
  | "settings.data_saver_title"
  | "settings.data_saver_desc";

const TRANSLATIONS: Record<SupportedLocale, Record<TranslationKey, string>> = {
  en: {
    "nav.home": "Home",
    "nav.explore": "Explore",
    "nav.create": "Create",
    "nav.hubs": "Hubs",
    "nav.inbox": "Inbox",
    "nav.griot": "GRIOT AI",
    "nav.developers": "Developers",
    "nav.business": "Business Suite",
    "nav.settings": "Settings",
    "offline.banner":
      "You appear to be offline. Cached views stay readable and queued actions sync automatically on reconnect.",
    "offline.queue_pending": "actions queued for sync",
    "offline.sync_now": "Sync now",
    "griot.title": "GRIOT AI — Permission-Bounded Assistant",
    "griot.privacy_badge": "Never reads private direct messages",
    "dev.title": "Ping Developer Platform",
    "settings.language_title": "Language & Regional Localisation",
    "settings.data_saver_title": "Data Saver (Low-Bandwidth Mode)",
    "settings.data_saver_desc":
      "Disables video autoplay and favours lightweight previews on metered mobile connections.",
  },
  fr: {
    "nav.home": "Accueil",
    "nav.explore": "Explorer",
    "nav.create": "Créer",
    "nav.hubs": "Hubs",
    "nav.inbox": "Boîte",
    "nav.griot": "GRIOT IA",
    "nav.developers": "Développeurs",
    "nav.business": "Espace Pro",
    "nav.settings": "Paramètres",
    "offline.banner":
      "Vous semblez hors ligne. Les vues en cache restent lisibles et vos actions en attente seront synchronisées automatiquement.",
    "offline.queue_pending": "actions en attente de synchronisation",
    "offline.sync_now": "Synchroniser",
    "griot.title": "GRIOT IA — Assistant à permissions limitées",
    "griot.privacy_badge": "Ne lit jamais les messages privés",
    "dev.title": "Plateforme Développeurs Ping",
    "settings.language_title": "Langue et localisation régionale",
    "settings.data_saver_title": "Économiseur de données (Bas débit)",
    "settings.data_saver_desc":
      "Désactive la lecture vidéo automatique et privilégie les aperçus légers sur réseau mobile.",
  },
  sw: {
    "nav.home": "Nyumbani",
    "nav.explore": "Gundua",
    "nav.create": "Unda",
    "nav.hubs": "Vikundi",
    "nav.inbox": "Ujumbe",
    "nav.griot": "GRIOT AI",
    "nav.developers": "Wasanidi",
    "nav.business": "Biashara",
    "nav.settings": "Mipangilio",
    "offline.banner":
      "Unaonekana uko nje ya mtandao. Kurasa zilizohifadhiwa zinasomeka na vitendo vitasawazishwa mtandao ukirudi.",
    "offline.queue_pending": "vitendo vinangoja kusawazishwa",
    "offline.sync_now": "Sawazisha sasa",
    "griot.title": "GRIOT AI — Msaidizi mwenye mipaka ya faragha",
    "griot.privacy_badge": "Hasomi ujumbe wa faragha kamwe",
    "dev.title": "Jukwaa la Wasanidi wa Ping",
    "settings.language_title": "Lugha na Mpangilio wa Kanda",
    "settings.data_saver_title": "Hifadhi Data (Mtandao wa Kasi Ndogo)",
    "settings.data_saver_desc":
      "Huzima uchezaji wa video otomatiki ili kupunguza matumizi ya data ya simu.",
  },
  ha: {
    "nav.home": "Gida",
    "nav.explore": "Bincika",
    "nav.create": "Ƙirƙira",
    "nav.hubs": "Ƙungiyoyi",
    "nav.inbox": "Saƙonni",
    "nav.griot": "GRIOT AI",
    "nav.developers": "Masu Haɓakawa",
    "nav.business": "Kasuwanci",
    "nav.settings": "Saituna",
    "offline.banner":
      "Ba ka kan intanet. Shafukan da aka adana za su ci gaba da aiki kuma za a aika saƙonni da zarar hanyar sadarwa ta dawo.",
    "offline.queue_pending": "ayyuka na jiran daidaitawa",
    "offline.sync_now": "Daidaita yanzu",
    "griot.title": "GRIOT AI — Mataimaki mai iyakar izini",
    "griot.privacy_badge": "Ba ya karanta saƙonnin sirri",
    "dev.title": "Dandalin Masu Haɓakawa na Ping",
    "settings.language_title": "Harshe da Yanki",
    "settings.data_saver_title": "Tattalin Data (Yanayin Ƙaramin Intanet)",
    "settings.data_saver_desc": "Yana dakatar da kunna bidiyo ta atomatik don rage amfani da data.",
  },
  yo: {
    "nav.home": "Ilé",
    "nav.explore": "Ṣàwárí",
    "nav.create": "Ṣẹ̀dá",
    "nav.hubs": "Àwùjọ",
    "nav.inbox": "Àpótí Ìfọ̀rọ̀wérọ̀",
    "nav.griot": "GRIOT AI",
    "nav.developers": "Olùgbékalẹ̀",
    "nav.business": "Ìṣòwò",
    "nav.settings": "Ètò",
    "offline.banner":
      "Kò sí ìsopọ̀ íntánẹ́ẹ̀tì. Àwọn ojú-ìwé tí a tọ́jú ṣì lè ṣí, àwọn iṣẹ́ tí o fi sílẹ̀ yóò sì rán ní kété tí ìsopọ̀ bá padà.",
    "offline.queue_pending": "iṣẹ́ ń dúró fún ìsopọ̀",
    "offline.sync_now": "Ṣe ìsopọ̀ báyìí",
    "griot.title": "GRIOT AI — Olùrànlọ́wọ́ Olóye pẹ̀lú Ìdáàbòbò Àṣírí",
    "griot.privacy_badge": "Kì í ka ìfọ̀rọ̀wérọ̀ àdáni rárá",
    "dev.title": "Pẹpẹ Àwọn Olùgbékalẹ̀ Ping",
    "settings.language_title": "Èdè àti Ìṣètò Agbègbè",
    "settings.data_saver_title": "Ìpamọ́ Dátà (Ìsopọ̀ Kékeré)",
    "settings.data_saver_desc": "Dá fídíò aládàáṣiṣẹ́ dúró láti dín lílo dátà kù lórí fóònù.",
  },
  ar: {
    "nav.home": "الرئيسية",
    "nav.explore": "استكشف",
    "nav.create": "إنشاء",
    "nav.hubs": "المجتمعات",
    "nav.inbox": "الرسائل",
    "nav.griot": "GRIOT AI",
    "nav.developers": "المطورون",
    "nav.business": "الأعمال",
    "nav.settings": "الإعدادات",
    "offline.banner":
      "يبدو أنك غير متصل بالإنترنت. ستظل الصفحات المحفوظة متاحة وستتم مزامنة الإجراءات تلقائياً عند عودة الاتصال.",
    "offline.queue_pending": "إجراءات بانتظار المزامنة",
    "offline.sync_now": "مزامنة الآن",
    "griot.title": "GRIOT AI — مساعد ذكي بحدود صلاحيات صارمة",
    "griot.privacy_badge": "لا يقرأ الرسائل الخاصة أبداً",
    "dev.title": "منصة مطوري Ping",
    "settings.language_title": "اللغة والتخصيص الإقليمي",
    "settings.data_saver_title": "توفير البيانات (الاتصال البطيء)",
    "settings.data_saver_desc":
      "يعطل التشغيل التلقائي للفيديو ويستخدم معاينات خفيفة لتقليل استهلاك البيانات.",
  },
};

const LOCALE_KEY = "ping_locale_v5";
const DATA_SAVER_KEY = "ping_low_bandwidth_v5";

let currentLocale: SupportedLocale = readInitialLocale();
let currentLowBandwidth: boolean = readInitialLowBandwidth();
const localeListeners = new Set<() => void>();
const dataSaverListeners = new Set<() => void>();

function isSupportedLocale(val: unknown): val is SupportedLocale {
  return SUPPORTED_LOCALES.some((l) => l.code === val);
}

function readInitialLocale(): SupportedLocale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // Ignore storage issues
  }
  return "en";
}

function readInitialLowBandwidth(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DATA_SAVER_KEY) === "true";
  } catch {
    return false;
  }
}

export function getLocaleMeta(locale: SupportedLocale = currentLocale): LocaleMeta {
  return SUPPORTED_LOCALES.find((l) => l.code === locale) ?? SUPPORTED_LOCALES[0]!;
}

export function applyDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === "undefined") return;
  const meta = getLocaleMeta(locale);
  document.documentElement.lang = meta.code;
  document.documentElement.dir = meta.dir;
}

export function setAppLocale(locale: SupportedLocale, userId?: string | null): void {
  if (!isSupportedLocale(locale)) return;
  currentLocale = locale;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // Ignore storage errors
    }
  }
  applyDocumentLocale(locale);
  localeListeners.forEach((fn) => fn());

  if (userId) {
    void (supabase as any)
      .from("profiles")
      .update({ preferred_locale: locale })
      .eq("id", userId)
      .then(
        () => {},
        () => {},
      );
  }
}

export function setLowBandwidthMode(enabled: boolean, userId?: string | null): void {
  currentLowBandwidth = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DATA_SAVER_KEY, enabled ? "true" : "false");
    } catch {
      // Ignore storage errors
    }
  }
  dataSaverListeners.forEach((fn) => fn());

  if (userId) {
    void (supabase as any)
      .from("profiles")
      .update({ low_bandwidth_mode: enabled })
      .eq("id", userId)
      .then(
        () => {},
        () => {},
      );
  }
}

export function useLocale(): {
  locale: SupportedLocale;
  meta: LocaleMeta;
  t: (key: TranslationKey) => string;
  setLocale: (next: SupportedLocale, userId?: string | null) => void;
} {
  const locale = useSyncExternalStore(
    (cb) => {
      localeListeners.add(cb);
      return () => localeListeners.delete(cb);
    },
    () => currentLocale,
    () => "en" as SupportedLocale,
  );
  return {
    locale,
    meta: getLocaleMeta(locale),
    t: (key: TranslationKey) => translate(key, locale),
    setLocale: setAppLocale,
  };
}

export function useLowBandwidthMode(): {
  lowBandwidth: boolean;
  setLowBandwidth: (next: boolean, userId?: string | null) => void;
} {
  const lowBandwidth = useSyncExternalStore(
    (cb) => {
      dataSaverListeners.add(cb);
      return () => dataSaverListeners.delete(cb);
    },
    () => currentLowBandwidth,
    () => false,
  );
  return {
    lowBandwidth,
    setLowBandwidth: setLowBandwidthMode,
  };
}

export function translate(key: TranslationKey, locale: SupportedLocale = currentLocale): string {
  return TRANSLATIONS[locale]?.[key] ?? TRANSLATIONS.en[key] ?? key;
}

export function formatRegionalCurrency(
  amountMajor: number,
  currency = "USD",
  locale: SupportedLocale = currentLocale,
): string {
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : locale, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: currency.toUpperCase() === "XOF" ? 0 : 2,
    }).format(amountMajor);
  } catch {
    return `${currency.toUpperCase()} ${amountMajor.toFixed(2)}`;
  }
}
