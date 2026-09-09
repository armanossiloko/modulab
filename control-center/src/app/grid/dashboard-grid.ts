import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  inject,
  effect,
  signal,
} from '@angular/core';
import {
  Gridster,
  GridsterConfig,
  GridsterItem,
  GridsterItemConfig,
  GridType,
  CompactType,
  DisplayGrid,
} from 'angular-gridster2';
import { DashboardService } from '../core/services/dashboard.service';
import { PageItem } from '../core/models/dashboard';
import { WidgetHost } from '../widgets/widget-host';
import { defaultWidgetTitle } from '../widgets/widget-catalog';
import { Subject, debounceTime } from 'rxjs';

/** Target square cell size (matches previous VerticalFixed row height). */
const CELL_PX = 56;
/** Layout coordinates are stored in this column system. */
const BASE_COLS = 12;

type GridItem = GridsterItemConfig & {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};

@Component({
  selector: 'app-dashboard-grid',
  imports: [Gridster, GridsterItem, WidgetHost],
  template: `
    <div #wrap class="grid-wrap" [class.is-editing]="dash.editMode()">
      <gridster [options]="options">
        @for (item of items(); track item.id) {
          <gridster-item [item]="item">
            <article class="widget-card">
              <app-widget-host
                [type]="item.type"
                [title]="widgetTitle(item)"
                [config]="item.config || {}"
              >
                @if (dash.editMode()) {
                  <button
                    widgetActions
                    type="button"
                    class="remove-btn"
                    title="Remove widget"
                    (click)="remove(item.id); $event.stopPropagation()"
                    (mousedown)="$event.stopPropagation()"
                    (touchstart)="$event.stopPropagation()"
                  >
                    ×
                  </button>
                }
              </app-widget-host>
            </article>
          </gridster-item>
        }
      </gridster>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .grid-wrap {
      height: 100%;
      min-height: 0;
    }
    .grid-wrap.is-editing ::ng-deep gridster-item {
      outline: 1px dashed color-mix(in srgb, var(--accent) 35%, var(--border));
      outline-offset: -1px;
      border-radius: var(--radius);
    }
    .widget-card {
      height: 100%;
      min-height: 0;
      padding: 0.65rem 0.75rem;
      border-radius: var(--radius);
      background: var(--widget);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
    }
    .remove-btn {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      padding: 0;
    }
    .remove-btn:hover {
      color: var(--negative);
      border-color: color-mix(in srgb, var(--negative) 40%, var(--border));
    }
  `,
})
export class DashboardGrid implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('wrap') private wrapRef?: ElementRef<HTMLElement>;

  readonly dash = inject(DashboardService);
  readonly items = signal<GridItem[]>([]);
  private lastPageKey = '';
  private cols = BASE_COLS;
  private scale = 1;
  private resizeObserver?: ResizeObserver;

  private readonly save$ = new Subject<void>();
  private saveSub = this.save$.pipe(debounceTime(600)).subscribe(() => {
    this.dash.persistLayout().subscribe({ error: (e: Error) => console.error(e) });
  });

  options: GridsterConfig = {
    gridType: GridType.ScrollVertical,
    rowHeightRatio: 1,
    compactType: CompactType.None,
    margin: 10,
    outerMargin: true,
    minCols: BASE_COLS,
    maxCols: BASE_COLS,
    minRows: 1,
    maxRows: 400,
    defaultItemCols: 3,
    defaultItemRows: 2,
    minItemCols: 1,
    minItemRows: 1,
    displayGrid: DisplayGrid.None,
    draggable: { enabled: false },
    resizable: { enabled: false },
    pushItems: true,
    disableScrollHorizontal: true,
    itemChangeCallback: () => this.onLayoutChange(),
    itemResizeCallback: () => this.onLayoutChange(),
  };

  constructor() {
    effect(() => {
      const page = this.dash.activePage();
      const edit = this.dash.editMode();
      const epoch = this.dash.layoutEpoch();
      this.options = {
        ...this.options,
        draggable: { enabled: edit },
        resizable: { enabled: edit },
        displayGrid: edit ? DisplayGrid.Always : DisplayGrid.None,
      };
      queueMicrotask(() => this.options['api']?.optionsChanged?.());

      if (!page) return;
      const key = `${epoch}:${page.id}:${page.items.map((i) => i.id).join(',')}:${this.cols}`;
      if (key !== this.lastPageKey) {
        this.lastPageKey = key;
        this.items.set(page.items.map((p) => this.toGridItem(p)));
      }
    });
  }

  ngOnInit(): void {
    /* effect handles sync */
  }

  ngAfterViewInit(): void {
    const el = this.wrapRef?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      this.applyColumnCount(width);
    });
    this.resizeObserver.observe(el);
    this.applyColumnCount(el.clientWidth);
  }

  ngOnDestroy(): void {
    this.saveSub.unsubscribe();
    this.resizeObserver?.disconnect();
  }

  widgetTitle(item: GridItem): string {
    return defaultWidgetTitle(item.type, {
      ...this.dash.widgetConfig(item.type),
      ...(item.config || {}),
    });
  }

  remove(id: string): void {
    this.dash.removeWidget(id);
  }

  /** More ~CELL_PX-wide columns as the viewport grows; rows stay square. */
  private applyColumnCount(width: number): void {
    const margin = this.options.margin ?? 10;
    const next = Math.max(
      BASE_COLS,
      Math.min(48, Math.floor((width + margin) / (CELL_PX + margin)))
    );
    if (next === this.cols) return;

    this.cols = next;
    this.scale = next / BASE_COLS;
    this.options = {
      ...this.options,
      minCols: next,
      maxCols: next,
      gridType: GridType.ScrollVertical,
      rowHeightRatio: 1,
    };
    const page = this.dash.activePage();
    if (page) {
      this.lastPageKey = `${this.dash.layoutEpoch()}:${page.id}:${page.items.map((i) => i.id).join(',')}:${this.cols}`;
      this.items.set(page.items.map((p) => this.toGridItem(p)));
    }
    queueMicrotask(() => this.options['api']?.optionsChanged?.());
  }

  private toGridItem(p: PageItem): GridItem {
    return {
      id: p.id,
      type: p.type,
      config: p.config,
      x: this.toDisplay(p.x),
      y: p.y,
      cols: Math.max(1, this.toDisplay(p.w)),
      rows: p.h,
    };
  }

  private toDisplay(n: number): number {
    return Math.max(0, Math.round(n * this.scale));
  }

  private toStored(n: number): number {
    return Math.max(0, Math.round(n / this.scale));
  }

  private onLayoutChange(): void {
    const page = this.dash.activePage();
    if (!page || !this.dash.editMode()) return;
    const next: PageItem[] = this.items().map((g) => ({
      id: g.id,
      type: g.type,
      x: this.toStored(g.x ?? 0),
      y: g.y ?? 0,
      w: Math.max(1, this.toStored(g.cols ?? 4)),
      h: g.rows ?? 2,
      config: g.config,
    }));
    this.dash.updatePageItems(page.id, next);
    this.save$.next();
  }
}
