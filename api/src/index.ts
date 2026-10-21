import { app } from './app';
import { config } from './config';
import { startBillingReminderScheduler } from './jobs/billingReminderScheduler';

app.listen(config.port, () => console.log(`API running on port ${config.port}`));
startBillingReminderScheduler();
