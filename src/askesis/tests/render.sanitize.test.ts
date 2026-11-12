import { describe, it, expect } from 'vitest';
import { sanitize, sanitizeHtmlToFragment } from '../render/dom';

/**
 * A varredura de atributos perigosos é compartilhada por sanitize() e
 * sanitizeHtmlToFragment(). Estes casos travam o contrato nas duas pontas: o
 * fragmento é reparseado a partir da string já limpa, e é nesse round-trip que
 * o mXSS aparece — a segunda passada não pode ser removida por "redundante".
 */
describe('varredura de atributos perigosos (as duas pontas)', () => {
  const HOSTILE = [
    '<a href="javascript:alert(1)">x</a>',
    '<img src="JavaScript:alert(2)">',
    '<p onclick="a()" onmouseover="b()">y</p>',
    '<svg><use xlink:href="javascript:alert(3)" /></svg>',
    '<div ONCLICK="c()">z</div>',
  ].join('');

  function attributesOf(fragment: DocumentFragment): string[] {
    const names: string[] = [];
    for (const el of fragment.querySelectorAll('*')) {
      for (const attr of Array.from(el.attributes)) names.push(`${attr.name.toLowerCase()}=${attr.value.trim().toLowerCase()}`);
    }
    return names;
  }

  it('sanitizeHtmlToFragment não deixa handler on* nem URI javascript:', () => {
    const attrs = attributesOf(sanitizeHtmlToFragment(HOSTILE));
    expect(attrs.filter(a => a.startsWith('on'))).toEqual([]);
    expect(attrs.filter(a => a.includes('javascript:'))).toEqual([]);
  });

  it('sanitize() chega ao mesmo resultado que o fragmento, sem divergir', () => {
    const viaString = sanitize(HOSTILE);
    expect(viaString.toLowerCase()).not.toMatch(/\son\w+=/);
    expect(viaString.toLowerCase()).not.toContain('javascript:');
  });

  it('preserva atributos legítimos de SVG e links seguros', () => {
    const fragment = sanitizeHtmlToFragment('<a href="https://example.com" class="ok">l</a><svg viewBox="0 0 24 24"><path d="M0 0"/></svg>');
    const attrs = attributesOf(fragment);
    expect(attrs).toContain('href=https://example.com');
    expect(attrs).toContain('class=ok');
    expect(attrs.some(a => a.startsWith('d='))).toBe(true);
  });
});

describe('sanitize (wrapper)', () => {
  it('removes <script> tags and on* attributes and returns string', () => {
    const html = '<div><script>alert(1)</script><p onclick="doIt()">hello</p></div>';
    const clean = sanitize(html);
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('onclick=');
    expect(typeof clean).toBe('string');
  });

  it('strips javascript: href but preserves safe hrefs', () => {
    const html = '<a href="javascript:alert(1)">bad</a><a href="https://example.com">ok</a>';
    const clean = sanitize(html);
    expect(clean).not.toContain('javascript:alert');
    expect(clean).toContain('https://example.com');
  });
});
