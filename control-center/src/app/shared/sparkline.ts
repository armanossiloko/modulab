import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';

export interface SparkPoint {
  at: string;
  value: number;
}

/**
 * Single-series trend line for stat tiles: muted 2px line, latest point in the accent,
 * crosshair + readout on hover. Values are percentages (0–100).
 */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="spark" (pointermove)="move($event)" (pointerleave)="hover.set(null)">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" role="img" [attr.aria-label]="label">
        <line class="spark__base" x1="0" [attr.y1]="H - 1" [attr.x2]="W" [attr.y2]="H - 1" />
        @if (path()) {
          <path class="spark__line" [attr.d]="path()" vector-effect="non-scaling-stroke" />
        }
        @if (hoverPoint(); as p) {
          <line class="spark__cross" [attr.x1]="p.x" y1="0" [attr.x2]="p.x" [attr.y2]="H" vector-effect="non-scaling-stroke" />
        }
      </svg>
      @if (last(); as p) {
        <span class="spark__dot" [style.left.%]="(p.x / W) * 100" [style.top.%]="(p.y / H) * 100"></span>
      }
      @if (hoverPoint(); as p) {
        <span class="spark__dot spark__dot--hover" [style.left.%]="(p.x / W) * 100" [style.top.%]="(p.y / H) * 100"></span>
        <span class="spark__tip" [class.is-left]="p.x > W / 2" [style.left.%]="(p.x / W) * 100">
          <strong>{{ p.value.toFixed(1) }}%</strong> {{ p.time }}
        </span>
      }
      @if (points.length < 2) {
        <span class="spark__empty">Collecting…</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .spark {
      position: relative;
      height: 36px;
      cursor: crosshair;
    }
    svg {
      width: 100%;
      height: 100%;
      overflow: visible;
      display: block;
    }
    .spark__base {
      stroke: var(--border-soft);
      stroke-width: 1;
    }
    .spark__line {
      fill: none;
      stroke: var(--text-muted);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .spark__cross {
      stroke: var(--border-strong);
      stroke-width: 1;
    }
    .spark__dot {
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 2px var(--widget);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .spark__dot--hover {
      background: var(--text);
    }
    .spark__tip {
      position: absolute;
      bottom: calc(100% + 6px);
      transform: translateX(-12px);
      padding: 0.2rem 0.45rem;
      border-radius: var(--radius-xs);
      background: var(--bg-elevated);
      box-shadow: var(--shadow-pop);
      font-size: var(--fs-xs);
      color: var(--text-dim);
      white-space: nowrap;
      pointer-events: none;
      z-index: 2;
    }
    .spark__tip.is-left {
      transform: translateX(calc(-100% + 12px));
    }
    .spark__tip strong {
      color: var(--text);
      font-weight: 650;
    }
    .spark__empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font-size: var(--fs-xs);
      color: var(--text-muted);
    }
  `,
})
export class Sparkline {
  readonly W = 200;
  readonly H = 36;
  private readonly data = signal<SparkPoint[]>([]);
  readonly hover = signal<number | null>(null);

  @Input() label = 'Trend';

  @Input() set points(value: SparkPoint[]) {
    this.data.set(value ?? []);
  }
  get points(): SparkPoint[] {
    return this.data();
  }

  private readonly coords = computed(() => {
    const pts = this.data();
    if (pts.length < 2) return [];
    const step = this.W / (pts.length - 1);
    // Fixed 0–100 scale: a quiet host should look quiet, not be stretched to fill the box.
    return pts.map((p, i) => ({
      x: i * step,
      y: this.H - 2 - (Math.min(100, Math.max(0, p.value)) / 100) * (this.H - 4),
      value: p.value,
      time: new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }));
  });

  readonly path = computed(() =>
    this.coords()
      .map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ')
  );

  readonly last = computed(() => this.coords().at(-1) ?? null);

  readonly hoverPoint = computed(() => {
    const i = this.hover();
    return i == null ? null : this.coords()[i] ?? null;
  });

  move(event: PointerEvent): void {
    const coords = this.coords();
    if (!coords.length) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    this.hover.set(Math.round(ratio * (coords.length - 1)));
  }
}
