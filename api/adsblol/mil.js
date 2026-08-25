import { createAdsbLolMilApiHandler } from '../../src/data/adsblolMil.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

/** Dedicated Vercel route for the adsb.lol military feed only. */
export default createAdsbLolMilApiHandler();
