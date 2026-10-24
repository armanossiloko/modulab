import { Component, EventEmitter, HostListener, Input, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  createCustomApp,
  getCustomApp,
  updateCustomApp,
  validateCustomApp,
  type CustomAppRequest,
  type CustomAppValidation,
} from '../../api/generated';
import { unwrap } from '../../core/services/api';

const TEMPLATE = `services:
  myapp:
    image: nginx:alpine
    container_name: myapp
    restart: unless-stopped
    ports:
      - "\${MODULAB_PUBLISH_IP:-0.0.0.0}:8090:80"
    volumes:
      - \${MODULAB_HOST_ROOT}/data/myapp:/usr/share/nginx/html
`;

/** Add or edit a user app (catalog.local/<id>/): metadata + a Docker Compose file. */
@Component({
  selector: 'app-custom-app-dialog',
  imports: [FormsModule],
  template: `
    <div class="overlay" (click)="closed.emit(false)"></div>
    <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="custom-title">
      <header class="overlay-head">
        <div>
          <h2 id="custom-title" class="overlay-title">{{ editId ? 'Edit ' + form.name : 'Add an app' }}</h2>
          <p class="page-subtitle">
            Any Docker Compose app. It appears in the Library and installs, updates, backs up and shows logs like the
            built-in ones.
          </p>
        </div>
      </header>
      <div class="overlay-body">
        <div class="field-grid">
          <label class="field">
            <span class="field__label">Id<span class="field__required" aria-hidden="true">*</span></span>
            <input
              class="input mono"
              [(ngModel)]="form.id"
              (ngModelChange)="onId($event)"
              [disabled]="!!editId"
              placeholder="myapp"
              spellcheck="false"
            />
            <span class="field__hint">Lowercase, used for the container name and data/{{ form.id || 'id' }}.</span>
          </label>
          <label class="field">
            <span class="field__label">Name<span class="field__required" aria-hidden="true">*</span></span>
            <input class="input" [(ngModel)]="form.name" placeholder="My app" />
          </label>
          <label class="field field-grid--full">
            <span class="field__label">Description</span>
            <input class="input" [(ngModel)]="form.description" />
          </label>
          <label class="field">
            <span class="field__label">Category</span>
            <select class="select" [(ngModel)]="form.category">
              <option value="media">Media</option>
              <option value="productivity">Productivity</option>
              <option value="tools">Tools</option>
              <option value="infrastructure">Infrastructure</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Web port on this host</span>
            <input class="input" type="number" min="1" max="65535" [(ngModel)]="form.port" placeholder="8090" />
            <span class="field__hint">Used for “Open” and the LAN hostname.</span>
          </label>
          <label class="field">
            <span class="field__label">LAN hostname</span>
            <span class="inline">
              <input
                class="input mono"
                [(ngModel)]="form.proxyHost"
                (ngModelChange)="hostTouched = true"
                placeholder="myapp"
                spellcheck="false"
              />
              <span class="muted">.{{ domain }}</span>
            </span>
          </label>
          <label class="field field-grid--full">
            <span class="field__label">docker-compose.yml<span class="field__required" aria-hidden="true">*</span></span>
            <textarea class="textarea mono compose" rows="14" [(ngModel)]="form.compose" spellcheck="false"></textarea>
            <span class="field__hint">
              Set <code>container_name</code> to the id. Mount data under <code>\${{ '{' }}MODULAB_HOST_ROOT{{ '}' }}/data/{{ form.id || 'id' }}</code>
              (not ./data) so it is backed up and survives updates. Lab values like <code>\${{ '{' }}TZ{{ '}' }}</code> and
              <code>\${{ '{' }}POSTGRES_PASSWORD{{ '}' }}</code> are available; join the external <code>modulab</code> network to
              reach the shared Postgres.
            </span>
          </label>
        </div>

        @if (validation(); as v) {
          @if (v.errors.length) {
            <ul class="msgs is-error" role="alert">
              @for (e of v.errors; track e) {
                <li>{{ e }}</li>
              }
            </ul>
          }
          @if (v.warnings.length) {
            <ul class="msgs">
              @for (w of v.warnings; track w) {
                <li>{{ w }}</li>
              }
            </ul>
          }
          @if (v.ok && !v.warnings.length) {
            <p class="ok">Looks good.</p>
          }
        }
        @if (error()) {
          <p class="msgs is-error" role="alert">{{ error() }}</p>
        }
      </div>
      <footer class="overlay-foot">
        <button type="button" class="btn btn--lg" (click)="closed.emit(false)">Cancel</button>
        <button type="button" class="btn btn--lg" [disabled]="busy()" (click)="check()">Check</button>
        <button type="button" class="btn btn--solid btn--lg" [disabled]="busy()" (click)="save()">
          {{ editId ? 'Save' : 'Add to Library' }}
        </button>
      </footer>
    </div>
  `,
  styles: `
    .wide {
      width: min(760px, calc(100vw - 2rem));
    }
    .mono {
      font-family: var(--mono);
      font-size: var(--fs-sm);
    }
    .compose {
      line-height: 1.5;
      tab-size: 2;
    }
    .inline {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .field__hint code {
      font-family: var(--mono);
      color: var(--text-dim);
    }
    .msgs {
      margin: var(--space-4) 0 0;
      padding: 0.6rem 0.8rem 0.6rem 1.8rem;
      border-radius: var(--radius-sm);
      border: 1px solid var(--accent-border);
      background: var(--accent-soft);
      font-size: var(--fs-sm);
      color: var(--text);
    }
    p.msgs {
      padding-left: 0.8rem;
    }
    .msgs.is-error {
      border-color: var(--negative-border);
      background: var(--negative-soft);
    }
    .ok {
      margin: var(--space-4) 0 0;
      font-size: var(--fs-sm);
      color: var(--positive);
    }
  `,
})
export class CustomAppDialog implements OnInit {
  @Input() editId: string | null = null;
  @Input() domain = 'network.lan';
  @Output() readonly closed = new EventEmitter<boolean>();

  readonly busy = signal(false);
  readonly validation = signal<CustomAppValidation | null>(null);
  readonly error = signal<string | null>(null);
  hostTouched = false;

  form = {
    id: '',
    name: '',
    description: '',
    category: 'other',
    port: null as number | null,
    proxyHost: '',
    compose: TEMPLATE,
  };

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit(false);
  }

  async ngOnInit(): Promise<void> {
    if (!this.editId) return;
    try {
      const app = await unwrap(getCustomApp({ throwOnError: false, path: { id: this.editId } }));
      this.form = {
        id: app.id,
        name: app.name,
        description: app.description,
        category: app.category,
        port: app.port == null ? null : Number(app.port),
        proxyHost: app.proxyHost ?? '',
        compose: app.compose,
      };
      this.hostTouched = true;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not load the app');
    }
  }

  /** Keep the template's names in step with the id until the user edits them. */
  onId(id: string): void {
    const slug = id.trim();
    if (!this.hostTouched) this.form.proxyHost = slug;
    if (this.form.compose.includes('myapp') && slug) {
      this.form.compose = TEMPLATE.replaceAll('myapp', slug);
    }
  }

  private body(): CustomAppRequest {
    return {
      id: this.form.id.trim(),
      name: this.form.name.trim(),
      description: this.form.description.trim() || null,
      category: this.form.category,
      port: this.form.port ? Number(this.form.port) : null,
      proxyHost: this.form.proxyHost.trim() || null,
      proxyPort: null,
      compose: this.form.compose,
      dataPaths: null,
      fields: null,
      defaults: null,
    };
  }

  async check(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.validation.set(
        await unwrap(validateCustomApp({ throwOnError: false, body: this.body(), query: { update: !!this.editId } }))
      );
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Check failed');
    } finally {
      this.busy.set(false);
    }
  }

  async save(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = this.editId
        ? await updateCustomApp({ throwOnError: false, path: { id: this.editId }, body: this.body() })
        : await createCustomApp({ throwOnError: false, body: this.body() });
      if (result.response?.status === 422) {
        this.validation.set(result.error as unknown as CustomAppValidation);
        return;
      }
      if (result.error) throw new Error((result.error as { message?: string }).message ?? 'Save failed');
      this.closed.emit(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }
}
