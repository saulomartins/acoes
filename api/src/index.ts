import { app } from './app';
import { config } from './config';
import { startBillingReminderScheduler } from './jobs/billingReminderScheduler';
import { query } from './db';
import { pruneAndroidReleaseFiles } from './services/mobileReleaseStorage';

app.listen(config.port, () => console.log(`API running on port ${config.port}`));
startBillingReminderScheduler();
// Limpa APKs antigos do volume a cada subida — é também o que libera o espaço
// acumulado antes desta limpeza existir, no primeiro deploy.
pruneAndroidReleaseFiles(query)
  .then(result => { if (result.removedFiles) console.log(`Removed ${result.removedFiles} old APK file(s), freed ${result.freedMb} MB`); })
  .catch(error => console.warn('Failed to prune old APKs', error));
