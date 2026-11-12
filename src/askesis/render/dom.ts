/**
 * @license
 * SPDX-License-Identifier: MIT
*/

/**
 * @file render/dom.ts
 * @description Abstrações de Baixo Nível para Manipulação do DOM (DOM Utils).
 */

import { t } from '../i18n';
import createDOMPurify from 'dompurify';

// Create a DOMPurify instance bound to the current window/document.
// Cast to `any` to satisfy DOMPurify's WindowLike typings across environments.
const DOMPurify = createDOMPurify((typeof window !== 'undefined' ? window : globalThis) as any);

// Centralized allowlists used by both the string sanitizer and fragment builder.
const ALLOWED_TAGS = [
    'a', 'b', 'i', 'em', 'strong', 'p', 'ul', 'ol', 'li', 'br', 'span', 'div', 'img',
    'svg', 'path', 'g', 'defs', 'symbol', 'use', 'rect', 'circle', 'ellipse', 'line',
    'polyline', 'polygon', 'stop', 'lineargradient', 'title', 'desc', 'clippath', 'mask', 'pattern', 'metadata'
];

const ALLOWED_ATTR = [
    'href', 'src', 'alt', 'title', 'class', 'id', 'width', 'height', 'viewbox', 'viewBox', 'xmlns', 'xmlns:xlink',
    'preserveAspectRatio', 'preserveaspectratio', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity',
    'transform', 'transform-origin', 'cx', 'cy', 'r', 'x', 'y', 'points', 'offset', 'stop-color', 'stop-opacity',
    'xlink:href', 'aria-hidden', 'focusable', 'role', 'clip-path', 'mask', 'clip-rule', 'stroke-miterlimit',
    'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'vector-effect'
];

const URL_ATTRS = new Set(['href', 'src', 'xlink:href']);

/**
 * Remove handlers `on*` e URIs `javascript:` que tenham sobrevivido ao DOMPurify.
 *
 * Roda em CADA parse, e não só uma vez: serializar e reinterpretar HTML é o vetor
 * clássico de mXSS, então todo conteúdo que volta a ser parseado é varrido de novo.
 */
function stripDangerousAttributes(root: DocumentFragment | HTMLElement) {
    for (const el of root.querySelectorAll('*')) {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = (attr.value || '').trim().toLowerCase();
            if (name.startsWith('on') || (URL_ATTRS.has(name) && value.startsWith('javascript:'))) {
                el.removeAttribute(attr.name);
            }
        }
    }
}

/**
 * Wrapper de sanitização que retorna string segura (DOMPurify).
 * Use quando for necessário manipular HTML como string antes de parsear.
 */
export function sanitize(html: string): string {
    const cleaned = DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        RETURN_TRUSTED_TYPE: false,
    }) as string;

    try {
        const template = document.createElement('template');
        template.innerHTML = cleaned;
        stripDangerousAttributes(template.content);
        return template.innerHTML;
    } catch {
        return cleaned;
    }
}

/**
 * `createElement` com classe e filhos, que é o formato de quase todo nó criado
 * no app. Strings viram nós de texto (nunca HTML), então o caminho é seguro por
 * construção. Deliberadamente mínimo: sem props mágicas, sem diffing, sem ciclo
 * de vida — quem precisa de mais ajusta a referência devolvida, como antes.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (children.length) node.append(...children);
    return node;
}

/**
 * OTIMIZAÇÃO DE PERFORMANCE: Helper para atualizar texto do DOM.
 */
export function setTextContent(element: Element | null, text: string) {
    if (!element) return;
    if (element.firstChild && element.firstChild.nodeType === 3 && !element.firstChild.nextSibling) {
        if (element.firstChild.nodeValue !== text) {
            element.firstChild.nodeValue = text;
        }
    } else {
        if (element.textContent !== text) {
            element.textContent = text;
        }
    }
}

/**
 * Atualiza os atributos ARIA para o componente 'Reel Rotary'.
 */
export function updateReelRotaryARIA(viewportEl: HTMLElement, currentIndex: number, options: readonly string[] | string[], labelKey: string) {
    if (!viewportEl) return;
    viewportEl.setAttribute('role', 'slider');
    viewportEl.setAttribute('aria-label', t(labelKey));
    viewportEl.setAttribute('aria-valuemin', '1');
    viewportEl.setAttribute('aria-valuemax', String(options.length));
    viewportEl.setAttribute('aria-valuenow', String(currentIndex + 1));
    viewportEl.setAttribute('aria-valuetext', options[currentIndex] || '');
    viewportEl.setAttribute('tabindex', '0');
}

const MAX_DOM_TEMPLATE_CACHE_SIZE = 256;
const _trustedSvgCache = new Map<string, Element>();
const _sanitizedFragmentCache = new Map<string, HTMLTemplateElement>();

/**
 * Renderiza SVG confiavel sem usar innerHTML no elemento de destino.
 */
export function setTrustedSvgContent(element: Element | null, svgOrText: string) {
    if (!element) return;
    if (!svgOrText) {
        element.replaceChildren();
        return;
    }

    if (!svgOrText.trim().startsWith('<svg')) {
        element.textContent = svgOrText;
        return;
    }

    try {
        let cachedSvg = _trustedSvgCache.get(svgOrText);
        if (!cachedSvg) {
            const parsed = new DOMParser().parseFromString(svgOrText, 'image/svg+xml');
            const svg = parsed.documentElement;
            if (svg.nodeName.toLowerCase() !== 'svg') {
                element.textContent = svgOrText;
                return;
            }
            if (_trustedSvgCache.size >= MAX_DOM_TEMPLATE_CACHE_SIZE) _trustedSvgCache.clear();
            cachedSvg = document.importNode(svg, true);
            _trustedSvgCache.set(svgOrText, cachedSvg);
        }
        element.replaceChildren(cachedSvg.cloneNode(true));
    } catch {
        element.textContent = svgOrText;
    }
}

/**
 * Renderiza markup leve e confiavel usando DocumentFragment, sem atribuicao de innerHTML.
 */
export function setTrustedHtmlFragment(target: HTMLElement | null, html: string) {
    if (!target) return;
    const normalized = html || '';
    const current = target.getAttribute('data-rendered-html') || '';
    if (current === normalized) return;

    if (!normalized) {
        target.replaceChildren();
        target.setAttribute('data-rendered-html', '');
        return;
    }

    // Use centralized sanitizer to avoid unsafe insertion via createContextualFragment
    // sanitizeHtmlToFragment removes disallowed tags/attributes before returning a DocumentFragment
    const fragment = sanitizeHtmlToFragment(normalized);
    target.replaceChildren(fragment);
    target.setAttribute('data-rendered-html', normalized);
}

/**
 * Analisa uma string HTML, remove tags e atributos perigosos e retorna um DocumentFragment seguro.
 * Bloqueia: script, iframe, object, embed, link, meta, style, handlers on*, javascript: hrefs.
 */
export function sanitizeHtmlToFragment(html: string): DocumentFragment {
    let cachedTemplate = _sanitizedFragmentCache.get(html);
    if (!cachedTemplate) {
        const template = document.createElement('template');
        template.innerHTML = sanitize(html);
        // Segunda varredura obrigatória: o parse acima reinterpreta a string devolvida
        // por sanitize(), e é justamente nesse round-trip que o mXSS se manifesta.
        stripDangerousAttributes(template.content);
        if (_sanitizedFragmentCache.size >= MAX_DOM_TEMPLATE_CACHE_SIZE) _sanitizedFragmentCache.clear();
        _sanitizedFragmentCache.set(html, template);
        cachedTemplate = template;
    }
    return cachedTemplate.content.cloneNode(true) as DocumentFragment;
}