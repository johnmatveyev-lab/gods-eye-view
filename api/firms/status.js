import { config, createVercelFirmsHandler } from '../../src/data/firms.js';

export { config };
export default createVercelFirmsHandler('/api/firms/status');
