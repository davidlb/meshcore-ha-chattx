import { t } from '../i18n';
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HomeAssistant } from '../types';
import { modalFrameStyles, panelStyles } from '../styles';
import { attachDialogA11y } from '../utils/dialog-a11y';
import { distanceKm } from '../utils/path-route';
import { formatLength } from '../utils/units';
import {
  LOCATION_SOURCES, formatLocation, osmUrl, validLocation, wrapLon,
  type LatLon, type LocationSourceId,
} from '../utils/location';
import { loadOwnPosition } from './path-map';
import './nodes-map';

/**
 * Locations in messages.
 *
 * mode "pick": choose a place to send, from the radio's saved position, Home
 * Assistant's home, a tap on the map, or (prepared, not finished) a GPS
 * receiver. Fires `location-selected` with the text to insert.
 *
 * mode "view": show a place from a message on the map (online or offline),
 * with its distance from us and a link to OpenStreetMap.
 */
@customElement('chattx-location-dialog')
export class LocationDialog extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ type: Boolean }) open = false;
  @property({ type: String }) mode: 'pick' | 'view' = 'pick';
  /** The place to show in "view" mode. */
  @property({ attribute: false }) place: LatLon | null = null;
  @property({ type: String }) entryId?: string;

  @state() private _source: LocationSourceId = 'node';
  @state() private _found: Partial<Record<LocationSourceId, LatLon | null>> = {};
  @state() private _picked: LatLon | null = null;
  @state() private _own: LatLon | null = null;

  static styles = [panelStyles, css`
    :host { display: contents; }
    .dialog-overlay { z-index: 1100; }
    .dialog { max-width: 560px; width: 100%; }
    .sources { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .source { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--primary-text-color); }
    .source.disabled { color: var(--secondary-text-color); }
    .source .coords { margin-left: auto; font-family: monospace; font-size: 12px; color: var(--secondary-text-color); }
    .badge { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: rgba(127, 127, 127, 0.2); }
    .map { display: flex; height: 340px; }
    .hint { font-size: 12px; color: var(--secondary-text-color); margin: 6px 0; }
    .result { font-family: monospace; font-size: 14px; margin-top: 8px; }
    .result a { color: var(--primary-color); }
  `, modalFrameStyles];

  constructor() {
    super();
    attachDialogA11y(this, {
      isOpen: () => this.open,
      onEscape: () => this._close(),
    });
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open && this.hass) {
      this._picked = null;
      void loadOwnPosition(this.hass).then((p) => { this._own = p; });
      if (this.mode === 'pick') void this._loadSources();
    }
  }

  private async _loadSources() {
    const found: Partial<Record<LocationSourceId, LatLon | null>> = {};
    for (const source of LOCATION_SOURCES) {
      if (source.id === 'map' || !source.ready) continue;
      found[source.id] = await source.get(this.hass!, this.entryId);
    }
    this._found = found;
    // Start with the first source that has a place, else the map.
    this._source = (['node', 'home'] as LocationSourceId[]).find((id) => found[id]) ?? 'map';
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private _chosen(): LatLon | null {
    if (this._source === 'map') return this._picked;
    return this._found[this._source] ?? null;
  }

  private _insert() {
    const place = this._chosen();
    if (!place) return;
    this.dispatchEvent(new CustomEvent('location-selected', {
      detail: { text: formatLocation(place), place },
      bubbles: true,
      composed: true,
    }));
  }

  private _onPicked(e: CustomEvent<LatLon>) {
    const place = { lat: e.detail.lat, lon: wrapLon(e.detail.lon) };
    if (validLocation(place.lat, place.lon)) {
      this._picked = place;
      this._source = 'map';
    }
  }

  private _sourceLabel(id: LocationSourceId): string {
    switch (id) {
      case 'node': return t('Position saved in the radio');
      case 'home': return t('Home Assistant home');
      case 'map': return t('Pick on the map');
      default: return t('GPS receiver connected to Home Assistant');
    }
  }

  private _distance(place: LatLon): string {
    if (!this._own) return '';
    const km = distanceKm(this._own.lat, this._own.lon, place.lat, place.lon);
    return km < 0.05 ? '' : t('{distance} from you', { distance: formatLength(km) });
  }

  private _renderPick() {
    const chosen = this._chosen();
    return html`
      <div class="sources" role="radiogroup" aria-label=${t('Location')}>
        ${LOCATION_SOURCES.map((source) => {
          const place = source.id === 'map' ? this._picked : this._found[source.id];
          const disabled = !source.ready || (source.id !== 'map' && !place);
          return html`<label class="source ${disabled ? 'disabled' : ''}">
            <input type="radio" name="chattx-location-source" .checked=${this._source === source.id} ?disabled=${disabled}
              @change=${() => { this._source = source.id; }} />
            ${this._sourceLabel(source.id)}
            ${!source.ready ? html`<span class="badge">${t('Coming later')}</span>` : nothing}
            ${place ? html`<span class="coords">${formatLocation(place).slice(3)}</span>` : nothing}
          </label>`;
        })}
      </div>
      <div class="map">
        <chattx-nodes-map .hass=${this.hass} .home=${this._own} .pin=${chosen} pickable no-legend max-fit-zoom="10"
          @location-picked=${this._onPicked}></chattx-nodes-map>
      </div>
      <div class="hint">${t('Tap the map to pick a place; drag and zoom as usual. Works with the offline map too.')}</div>
      ${chosen ? html`<div class="result">${formatLocation(chosen)}${this._distance(chosen) ? html` · ${this._distance(chosen)}` : nothing}</div>` : nothing}
    `;
  }

  private _renderView() {
    const place = this.place;
    if (!place) return nothing;
    return html`
      <div class="map">
        <chattx-nodes-map .hass=${this.hass} .home=${this._own} .pin=${place} no-legend max-fit-zoom="10"></chattx-nodes-map>
      </div>
      <div class="result">${formatLocation(place)}${this._distance(place) ? html` · ${this._distance(place)}` : nothing}</div>
      <div class="result"><a href=${osmUrl(place)} target="_blank" rel="noopener noreferrer">${t('Open in OpenStreetMap')}</a></div>
    `;
  }

  render() {
    if (!this.open) return nothing;
    const pick = this.mode === 'pick';
    const title = pick ? t('Send a location') : t('Location');
    return html`
      <div class="dialog-overlay" @click=${this._close}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label=${title}
          @click=${(e: Event) => e.stopPropagation()}>
          <div class="dialog-header"><div class="dialog-header-title">📍 ${title}</div></div>
          <div class="dialog-body">${pick ? this._renderPick() : this._renderView()}</div>
          <div class="dialog-footer">
            <button class="dialog-button" @click=${this._close}>${pick ? t('Cancel') : t('Close')}</button>
            ${pick ? html`<button class="dialog-button primary" ?disabled=${!this._chosen()} @click=${this._insert}>
              ${t('Insert into message')}</button>` : nothing}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chattx-location-dialog': LocationDialog;
  }
}
