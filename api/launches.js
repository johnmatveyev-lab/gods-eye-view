import { handleLaunchesHttp } from '../src/data/launches.js';

export default async function handler(req, res) {
  await handleLaunchesHttp(req, res);
}
