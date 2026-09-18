import { EDUCATION_LEVEL_LABEL_RU } from '@core/kernel/profile';
import { applicantCategoryRu, documentRu, scaleRu, subjectRu } from '@core/i18n/labels';

/** Convert known data keys only at the presentation boundary. */
export function readableLabel(text: string): string {
  return text.replace(/\b[a-z][a-z0-9_]*\b/g, (key) => {
    const education = EDUCATION_LEVEL_LABEL_RU[key as keyof typeof EDUCATION_LEVEL_LABEL_RU];
    if (education) return education;
    for (const lookup of [documentRu, subjectRu, scaleRu, applicantCategoryRu]) {
      const label = lookup(key);
      if (label !== key) return label;
    }
    return key;
  });
}
