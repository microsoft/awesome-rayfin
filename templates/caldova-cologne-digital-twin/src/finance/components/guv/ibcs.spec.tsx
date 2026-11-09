// Ported from the cockpit (a392659) with react-dom/server instead of @testing-library, which this repo does
// not use; the assertions are Michael's.
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { VarianceBar, VariancePin } from './ibcs';

const firstRect = (el: ReactElement) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(el);
  return host.querySelector('rect')!;
};

describe('variance marks: direction by sign, colour by impact', () => {
  it('draws a cost increase to the right in red', () => {
    const rect = firstRect(<VarianceBar value={5} good={false} max={10} width={90} />);
    expect(rect.getAttribute('x')).toBe('45');
    expect(rect.getAttribute('fill')).toBe('var(--color-bad)');
  });

  it('keeps the old behaviour without good: positive is right and green', () => {
    const rect = firstRect(<VarianceBar value={-5} max={10} width={90} />);
    expect(Number(rect.getAttribute('x'))).toBeLessThan(45);
    expect(rect.getAttribute('fill')).toBe('var(--color-bad)');
  });

  it('points a relative cost increase right: red stem, head in the AC notation (ink)', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<VariancePin value={0.2} good={false} max={0.4} width={70} />);
    const head = host.querySelector('rect')!;
    expect(Number(head.getAttribute('x'))).toBeGreaterThan(35);
    expect(host.querySelector('line')!.getAttribute('stroke')).toBe('var(--color-bad)');
    expect(head.getAttribute('fill')).toBe('var(--color-ac)');
  });

  it('draws the head hatched when the base column holds forecast months', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<VariancePin value={-0.1} max={0.4} width={70} minuend="ACFC" />);
    const head = [...host.querySelectorAll('rect')].find((r) => r.getAttribute('width') === '7')!;
    expect(head.getAttribute('fill')).toBe('url(#pin-head-fc)');
  });
});
