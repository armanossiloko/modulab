import { TestBed } from '@angular/core/testing';
import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  function render(values: number[]) {
    const fixture = TestBed.createComponent(Sparkline);
    fixture.componentInstance.points = values.map((value, i) => ({
      at: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString(),
      value,
    }));
    fixture.detectChanges();
    return fixture;
  }

  it('waits for two points before drawing', () => {
    const el: HTMLElement = render([40]).nativeElement;
    expect(el.querySelector('.spark__line')).toBeNull();
    expect(el.textContent).toContain('Collecting');
  });

  it('draws on a fixed 0–100 scale and marks the latest value', () => {
    const fixture = render([0, 50, 100]);
    const d = (fixture.nativeElement as HTMLElement).querySelector('.spark__line')!.getAttribute('d')!;
    const ys = d.split(/[ML]/).filter(Boolean).map((p) => Number(p.split(',')[1]));
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
    expect(fixture.componentInstance.last()?.value).toBe(100);
  });

  it('clamps values outside 0–100', () => {
    const fixture = render([150, -10]);
    const coords = fixture.componentInstance.path();
    expect(coords).toMatch(/^M0\.0,2\.0 L200\.0,34\.0$/);
  });
});
