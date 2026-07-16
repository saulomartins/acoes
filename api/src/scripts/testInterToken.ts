import { getInterAccessToken } from '../services/interService';

(async () => {
  const token = await getInterAccessToken();

  if (!token) {
    console.log('Inter token not requested: integration is not fully configured.');
    return;
  }

  console.log(`Inter token ok. Length: ${token.length}`);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
