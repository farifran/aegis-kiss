import { describe, it, expect } from 'vitest';
import { sanitizeHtmlToFragment } from '../render/dom';

describe('sanitizeHtmlToFragment', () => {
  it('removes <script> tags and on* attributes', () => {
    const frag = sanitizeHtmlToFragment('<div><script>alert(1)</script><p onclick="doIt()">hello</p></div>');
    const container = document.createElement('div');
    container.appendChild(frag.cloneNode(true));
    expect(container.querySelector('script')).toBeNull();
    const p = container.querySelector('p');
    expect(p).not.toBeNull();
    expect(p?.getAttribute('onclick')).toBeNull();
  });

  it('sanitizes javascript: href and keeps safe links', () => {
    const frag = sanitizeHtmlToFragment('<a href="javascript:alert(1)">bad</a><a href="https://example.com">ok</a>');
    const container = document.createElement('div');
    container.appendChild(frag.cloneNode(true));
    const bad = container.querySelector('a[href]');
    // The first link should no longer have a javascript: href
    expect(bad?.getAttribute('href')?.startsWith('javascript:')).not.toBe(true);
    const ok = Array.from(container.querySelectorAll('a')).find(a => a.getAttribute('href') === 'https://example.com');
    expect(ok).not.toBeUndefined();
  });
});
