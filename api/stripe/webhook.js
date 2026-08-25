import { config, createVercelBillingHandler } from '../../src/billing/vercel.js';

export { config };
export default createVercelBillingHandler('/api/stripe/webhook');
