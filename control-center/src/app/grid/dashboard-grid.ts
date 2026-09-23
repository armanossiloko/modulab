import {
  Component,
  OnInit,
  OnDestroy,
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
import { GRID_COLS } from '../core/services/layout-migrate';
import { Icon } from '../shared/icon';

type GridItem = GridsterItemConfig & {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};

@Component({
  selector: 'app-dashboard-grid',
  imports: [Gridster, GridsterItem, WidgetHost, Icon],
  template: `
    <div class="grid-wrap" [class.is-editing]="dash.editMode()">
      <gridster [options]="options">
        @for (item of items(); track item.id; let i = $index) {
          <gridster-item [item]="item">
            <article class="widget-card" [style.animation-delay.ms]="i * 35">
              <app-widget-host
                [type]="item.type"
                [title]="widgetTitle(item)"
                [config]="item.config || {}"
              />
              @if (dash.editMode()) {
                <button
                  type="button"
                  class="icon-btn icon-btn--sm icon-btn--danger remove-btn"
                  title="Remove widget"
                  aria-label="Remove widget"
                  (click)="remove(item.id); $event.stopPropagation()"
                  (mousedown)="$event.stopPropagation()"
                  (touchstart)="$event.stopPropagation()"
                >
                  <app-icon name="close" [size]="13" />
                </button>
              }
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
    .widget-card {
      position: relative;
      height: 100%;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: var(--radius);
      background: var(--widget);
      border: 1px solid var(--border-soft);
      box-shadow: var(--highlight), 0 1px 2px rgba(0, 0, 0, 0.25);
      container: widget / size;
      animation: rise-in 0.35s var(--ease) both;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .widget-card:hover {
      border-color: var(--border);
    }
    .is-editing .widget-card {
      border-style: dashed;
      border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
      cursor: grab;
    }
    .is-editing .widget-card:hover {
      border-color: var(--accent-border);
      box-shadow: var(--highlight), var(--accent-ring);
    }
    .is-editing app-widget-host {
      pointer-events: none;
      user-select: none;
    }
    .is-editing ::ng-deep .gridster-item-moving .widget-card {
      cursor: grabbing;
      box-shadow: var(--shadow-pop);
    }
    .remove-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      z-index: 2;
      background: var(--bg-elevated);
      animation: fade-in 0.15s ease both;
    }
  `,
})
export class DashboardGrid implements OnInit, OnDestroy {
  readonly dash = inject(DashboardService);
  readonly items = signal<GridItem[]>([]);
  private lastPageKey = '';

  private readonly save$ = new Subject<void>();
  private saveSub = this.save$.pipe(debounceTime(600)).subscribe(() => {
    this.dash.persistLayout().subscribe({ error: (e: Error) => console.error(e) });
  });

  options: GridsterConfig = {
    // Square cells: row height tracks column width (fills width across GRID_COLS).
    gridType: GridType.ScrollVertical,
    rowHeightRatio: 1,
    compactType: CompactType.None,
    margin: 10,
    outerMargin: true,
    outerMarginTop: 2,
    outerMarginLeft: 2,
    outerMarginRight: 2,
    outerMarginBottom: 10,
    minCols: GRID_COLS,
    maxCols: GRID_COLS,
    minRows: 1,
    maxRows: 400,
    defaultItemCols: 4,
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
      const key = `${epoch}:${page.id}:${page.items.map((i) => i.id).join(',')}`;
      if (key !== this.lastPageKey) {
        this.lastPageKey = key;
        this.items.set(page.items.map((p) => this.toGridItem(p)));
      }
    });
  }

  ngOnInit(): void {
    /* effect handles sync */
  }

  ngOnDestroy(): void {
    this.saveSub.unsubscribe();
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

  private toGridItem(p: PageItem): GridItem {
    return {
      id: p.id,
      type: p.type,
      config: p.config,
      x: p.x,
      y: p.y,
      cols: p.w,
      rows: p.h,
    };
  }

  private onLayoutChange(): void {
    const page = this.dash.activePage();
    if (!page || !this.dash.editMode()) return;
    const next: PageItem[] = this.items().map((g) => ({
      id: g.id,
      type: g.type,
      x: g.x ?? 0,
      y: g.y ?? 0,
      w: g.cols ?? 4,
      h: g.rows ?? 2,
      config: g.config,
    }));
    this.dash.updatePageItems(page.id, next);
    this.save$.next();
  }
}
