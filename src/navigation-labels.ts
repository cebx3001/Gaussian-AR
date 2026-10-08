import type { Lang } from './i18n';
import { isElVado } from './scene';

const compactLabels: Record<Lang, string[]> = {
    es: ['Vista\ngeneral', 'Plaza', 'Iglesia\ny cruz', 'Museo', 'Fuente'],
    en: ['Overview', 'Square', 'Church\n& Cross', 'Museum', 'Fountain']
};

const elVadoLabels: Record<string, string> = {
    'Vista general': 'Vista\ngeneral', 'Overview': 'Overview',
    'Cruz del Vado': 'Cruz\ndel Vado', 'The Cross': 'The Cross',
    'Plazoleta del Vado': 'Plazoleta', 'El Vado Square': 'Square',
    'Palo encebado': 'Palo\nencebado', 'Greased Pole': 'Greased\nPole',
    'Casa de la Lira': 'Casa de\nla Lira', 'House of the Lyre': 'House of\nthe Lyre',
    'Casa Museo La Condamine': 'Museo\nCondamine', 'La Condamine House Museum': 'Condamine\nMuseum',
    'El Prohibido': 'El Prohibido',
    'Oficios tradicionales': 'Oficios', 'Traditional crafts': 'Crafts',
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
    compact.textContent = isElVado ? (elVadoLabels[label] ?? label) : (compactLabels[lang][index] ?? label);
    compact.setAttribute('aria-hidden', 'true');
    button.append(full, compact);
}
