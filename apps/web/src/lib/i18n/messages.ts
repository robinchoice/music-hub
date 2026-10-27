import * as common from './common.js';
import * as delivery from './delivery.js';
import * as guest from './guest.js';
import * as landing from './landing.js';
import * as overview from './overview.js';
import * as track from './track.js';
import * as workspace from './workspace.js';

// Every text of the web app, one file per area with a German and an English
// object. `en: typeof de` makes TypeScript report any text English lacks.
export const messages = {
  de: {
    common: common.de,
    delivery: delivery.de,
    guest: guest.de,
    landing: landing.de,
    overview: overview.de,
    track: track.de,
    workspace: workspace.de,
  },
  en: {
    common: common.en,
    delivery: delivery.en,
    guest: guest.en,
    landing: landing.en,
    overview: overview.en,
    track: track.en,
    workspace: workspace.en,
  },
};
