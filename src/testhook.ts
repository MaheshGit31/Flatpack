// Test/benchmark hook. Exposes the real pipeline on window so Playwright and the benchmark builder can drive it. No network, no data leaves the page.
import { importImages } from './capture/importer';
import { searchClient } from './search/client';
import { indexClient } from './workers/client';
import { audioClient } from './workers/audioClient';
import { recorder } from './capture/recorder';
import * as store from './store/db';

declare global { interface Window { __flatpak?: unknown } }
window.__flatpak = { importImages, searchClient, indexClient, audioClient, recorder, store };
