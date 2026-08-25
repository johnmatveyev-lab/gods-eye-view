import { createAdsbLolMilApiHandler } from '../../src/data/adsblolMil.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

/** Dedicated Vercel route — not the live catch-all, not AIS, not OpenSky. */
export default createAdsbLolMilApiHandler();
