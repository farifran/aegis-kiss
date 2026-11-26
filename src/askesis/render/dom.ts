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
        const parsed = new DOMParser().parseFromString(svgOrText, 'image/svg+xml');
        const svg = parsed.documentElement;
        if (svg.nodeName.toLowerCase() !== 'svg') {
            element.textContent = svgOrText;
            return;
        }
        const imported = document.importNode(svg, true);
        element.replaceChildren(imported);
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
    // Use DOMPurify to produce a safe HTML string, then parse into a DocumentFragment.
    const allowedTags = [
        'a', 'b', 'i', 'em', 'strong', 'p', 'ul', 'ol', 'li', 'br', 'span', 'div', 'img',
        // SVG tags commonly used by the app's icon set + accessibility/structure tags
        'svg', 'path', 'g', 'defs', 'symbol', 'use', 'rect', 'circle', 'ellipse', 'line',
        'polyline', 'polygon', 'stop', 'lineargradient', 'title', 'desc', 'clippath', 'mask', 'pattern', 'metadata'
    ];

    const allowedAttrs = [
        // Generic attributes
        'href', 'src', 'alt', 'title', 'class', 'id', 'width', 'height', 'viewbox', 'viewBox', 'xmlns', 'xmlns:xlink',
        // Preserve common SVG sizing/presentation attributes
        'preserveAspectRatio', 'preserveaspectratio',
        // SVG-specific attributes required to render vector icons
        'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity',
        'transform', 'transform-origin', 'cx', 'cy', 'r', 'x', 'y', 'points', 'offset', 'stop-color', 'stop-opacity',
        'xlink:href', 'href', 'aria-hidden', 'focusable', 'role', 'clip-path', 'mask', 'clip-rule', 'stroke-miterlimit',
        'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'vector-effect'
    ];

    const clean = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: allowedAttrs,
        // prevent returning non-string structures in certain environments
        RETURN_TRUSTED_TYPE: false,
    }) as string;

    const template = document.createElement('template');
    template.innerHTML = clean;

    // Extra hardening: garantir que qualquer atributo 'on*' e href/src javascript: sejam removidos
    const elements = template.content.querySelectorAll('*');
    for (const el of elements) {
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
            const attrName = attr.name.toLowerCase();
            const attrValue = (attr.value || '').trim().toLowerCase();
            if (attrName.startsWith('on')) {
                el.removeAttribute(attr.name);
                continue;
            }
            if ((attrName === 'href' || attrName === 'src' || attrName === 'xlink:href') && attrValue.startsWith('javascript:')) {
                el.removeAttribute(attr.name);
            }
        }
    }

    return template.content;
}