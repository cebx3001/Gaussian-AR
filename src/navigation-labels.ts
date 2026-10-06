import type { Lang } from './i18n';

const compactLabels: Record<Lang, string[]> = {
    es: ['Vista\ngeneral', 'Plaza', 'Iglesia\ny cruz', 'Museo', 'Fuente'],
    en: ['Overview', 'Square', 'Church\n& Cross', 'Museum', 'Fountain']
};

/** Keep the complete destination accessible while fitting five labels on mobile. */
export function appendDestinationLabel(button: HTMLButtonElement, label: string, index: number, lang: Lang) {
    button.setAttribute('aria-label', label);
    button.title = label;
    const full = document.createElement('span');
    full.className = 'nav-full';
    full.textContent = label;
    const compact = document.createElement('span');
    compact.className = 'nav-compact';
    compact.textContent = compactLabels[lang][index] ?? label;
    compact.setAttribute('aria-hidden', 'true');
    button.append(full, compact);
}
