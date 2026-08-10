// Fuso do condomínio (Brasil). O processo do servidor roda em UTC — nunca
// usar Date.getHours()/toDateString()/getDate() direto pra decidir "que dia
// é hoje" ou "que horas são" do ponto de vista do condomínio.
export const CONDOMINIUM_TIME_ZONE = 'America/Sao_Paulo';

export const localDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CONDOMINIUM_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value || 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
};

export const localDayKey = (date: Date) => { const p = localDateParts(date); return `${p.year}-${p.month}-${p.day}`; };
export const localMinutesOfDay = (date: Date) => { const p = localDateParts(date); return p.hour * 60 + p.minute; };

// Brasil não observa horário de verão desde 2019 — sempre UTC-3. Meia-noite
// local em UTC é, portanto, sempre 03:00 UTC do mesmo dia-calendário local.
const BRAZIL_UTC_OFFSET_HOURS = 3;
export const brazilMidnightUtc = (daysAgo = 0) => {
  const today = localDateParts(new Date());
  return new Date(Date.UTC(today.year, today.month - 1, today.day - daysAgo, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
};
