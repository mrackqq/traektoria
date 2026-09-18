/**
 * Человеческие подписи внутренних идентификаторов.
 *
 * Правило простое: `kz_citizen`, `gpa_5`, `school_certificate` и `math` —
 * ключи данных, а не текст для пользователя. Любой экран и любое объяснение
 * ядра проходят через этот модуль. Неизвестный ключ возвращается как есть:
 * это заметно при проверке и честнее, чем подставить «—».
 */

const APPLICANT_CATEGORY: Record<string, string> = {
  kz_citizen: 'гражданин Казахстана',
  foreign: 'иностранный заявитель',
  kandas: 'кандас',
  rural_quota: 'сельская квота',
};

const CITIZENSHIP: Record<string, string> = {
  KZ: 'Казахстан',
  OTHER: 'другое государство',
};

const COUNTRY: Record<string, string> = {
  KZ: 'Казахстан',
  TR: 'Турция',
  DE: 'Германия',
};

const LANGUAGE: Record<string, string> = {
  ru: 'русский',
  kk: 'казахский',
  en: 'английский',
  tr: 'турецкий',
  de: 'немецкий',
};

const SUBJECT: Record<string, string> = {
  math: 'математика',
  physics: 'физика',
  informatics: 'информатика',
  chemistry: 'химия',
  biology: 'биология',
  geography: 'география',
  history: 'история Казахстана',
  english: 'английский язык',

  // Профильные предметы ЕНТ сверх школьного набора. «История Казахстана» —
  // обязательный блок ЕНТ, а профильный предмет — «всемирная история»:
  // это разные вещи, и раньше они сливались в одну.
  world_history: 'всемирная история',
  law_basics: 'основы права',
  foreign_language: 'иностранный язык',
  kazakh_language: 'казахский язык',
  kazakh_literature: 'казахская литература',
  russian_language: 'русский язык',
  russian_literature: 'русская литература',
  kazakh_or_russian_language: 'казахский или русский язык',
  kazakh_or_russian_literature: 'казахская или русская литература',
  physics_or_biology: 'физика или биология',
  creative_exam: 'творческий экзамен',
};

const DOCUMENT: Record<string, string> = {
  school_certificate: 'аттестат о среднем образовании',
  certified_translation: 'заверенный перевод аттестата',
  college_diploma: 'диплом колледжа',
  id_document: 'удостоверение личности',
};

const SCALE: Record<string, string> = {
  nuet_0_240: 'шкала NUET 0–240',
  sat_400_1600: 'шкала SAT 400–1600',
  act_1_36: 'шкала ACT 1–36',
  gpa_5: 'пятибалльная шкала',
  ielts_0_9: 'шкала IELTS 0–9',
  toefl_0_120: 'шкала TOEFL 0–120',
  ent_0_140: 'шкала ЕНТ 0–140',
  ent_subject: 'предметный балл ЕНТ',
};

const EXAM: Record<string, string> = {
  IELTS: 'IELTS Academic',
  TOEFL: 'TOEFL iBT',
  'ЕНТ': 'ЕНТ',
  NUET: 'NUET — вступительный экзамен Nazarbayev University',
  SAT: 'SAT',
  ACT: 'ACT',
};

const CEFR: Record<string, string> = {
  A1: 'A1 — начальный',
  A2: 'A2 — базовый',
  B1: 'B1 — средний',
  B2: 'B2 — выше среднего',
  C1: 'C1 — продвинутый',
  C2: 'C2 — владение в совершенстве',
};

function lookup(map: Record<string, string>, key: string | undefined): string {
  if (key === undefined || key === '') return 'не указано';
  return map[key] ?? key;
}

export const applicantCategoryRu = (v: string | undefined): string => lookup(APPLICANT_CATEGORY, v);
export const citizenshipRu = (v: string | undefined): string => lookup(CITIZENSHIP, v);
export const countryRu = (v: string | undefined): string => lookup(COUNTRY, v);
export const languageRu = (v: string | undefined): string => lookup(LANGUAGE, v);
export const subjectRu = (v: string | undefined): string => lookup(SUBJECT, v);
export const documentRu = (v: string | undefined): string => lookup(DOCUMENT, v);
export const scaleRu = (v: string | undefined): string => lookup(SCALE, v);
export const examRu = (v: string | undefined): string => lookup(EXAM, v);
export const cefrRu = (v: string | undefined): string => lookup(CEFR, v);

/** Подпись с заглавной буквы — для начала предложения и заголовка карточки. */
export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

export const SUBJECT_OPTIONS: readonly { value: string; label: string }[] = [
  'math',
  'physics',
  'informatics',
  'chemistry',
  'biology',
  'geography',
  'history',
].map((v) => ({ value: v, label: capitalize(subjectRu(v)) }));

export const COUNTRY_OPTIONS: readonly { value: string; label: string }[] = [
  'KZ',
  'TR',
  'DE',
].map((v) => ({ value: v, label: countryRu(v) }));
