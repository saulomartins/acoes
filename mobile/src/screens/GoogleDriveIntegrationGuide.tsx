import React, { useContext } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AuthContext } from '../context/AuthContext';
import { EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';

// Guia interno de apoio ao admin geral. É conteúdo estático (não consulta a
// API, não expõe credencial nenhuma) que documenta a integração com Google
// Drive já existente — usada para guardar comprovantes/notas fiscais da
// Prestação de Contas e anexos de Ocorrências fora do banco de dados. É uma
// única conta Google/credencial para toda a plataforma; o que isola um
// condomínio do outro é só a pasta configurada em cada um (ver Condomínios,
// api/src/services/googleDriveService.ts e api/src/scripts/authorizeGoogleDrive.ts).

const ACCOUNT_EMAIL = 'laremdia.condominio@gmail.com';

const steps = [
  {
    title: 'Criar a pasta no Google Drive',
    detail: 'Em qualquer conta Google (pode ser a do próprio síndico ou de quem cuida dos arquivos do condomínio), crie uma pasta dedicada — por exemplo "Lar em Dia - Nome do Condomínio". Pode ser em "Meu Drive" normal, não precisa ser um Drive compartilhado.',
  },
  {
    title: 'Compartilhar a pasta com a conta da plataforma',
    detail: `Clique em Compartilhar na pasta e adicione ${ACCOUNT_EMAIL} com permissão de Editor. Sem esse compartilhamento, todo envio de arquivo falha — a plataforma usa sempre essa mesma conta para ler e gravar em qualquer pasta configurada, de qualquer condomínio.`,
  },
  {
    title: 'Copiar o link da pasta',
    detail: 'Ainda na tela de compartilhamento (ou no menu "⋮" da pasta), use "Copiar link". O link tem o formato https://drive.google.com/drive/folders/algum-id.',
  },
  {
    title: 'Colar o link em Condomínios',
    detail: 'Abra Condomínios, edite o condomínio desejado e cole o link no campo "Pasta do Google Drive (Prestação de Contas)".',
  },
  {
    title: 'Testar a pasta antes de salvar',
    detail: 'Com o condomínio já existente (edição, não cadastro novo), aparece o botão "Testar pasta" ao lado do campo. Ele confirma que a pasta existe, não está na lixeira, e que a conta da plataforma realmente enxerga ela — evita descobrir um link errado ou um compartilhamento esquecido só quando o síndico for enviar um comprovante de verdade.',
  },
  {
    title: 'Salvar o condomínio',
    detail: 'Pronto — a partir daqui, os dois recursos abaixo passam a usar essa pasta para este condomínio.',
  },
];

const whatChanges = [
  'Prestação de Contas: nota fiscal e comprovante de pagamento anexados a uma despesa (síndico/subsíndico) são enviados para essa pasta, dentro de uma subpasta com o mês de referência (formato AAAA-MM, criada automaticamente na primeira vez que alguém envia um anexo naquele mês).',
  'Ocorrências: anexos de uma ocorrência seguem a mesma regra — mesma pasta raiz do condomínio, mesma organização por subpasta de mês.',
  'Sem a pasta configurada, os anexos continuam funcionando normalmente — ficam guardados como arquivo dentro do próprio banco de dados (Postgres), não em algum lugar temporário. A integração com o Drive é só uma opção de armazenamento externo, nunca um requisito.',
];

const commonErrors = [
  {
    title: '"O ID informado não corresponde a uma pasta do Google Drive" ou "não encontrada"',
    detail: 'O link colado não é de uma pasta (é de um arquivo, por exemplo), a pasta foi excluída, ou o ID foi digitado/copiado errado. Copie o link de novo direto do Drive.',
  },
  {
    title: '"Falha ao enviar o arquivo para o Google Drive" ao anexar um comprovante de verdade',
    detail: `Quase sempre é compartilhamento: alguém removeu ${ACCOUNT_EMAIL} do acesso à pasta depois de configurada, ou o compartilhamento foi feito com permissão de Leitor em vez de Editor. Reabra o compartilhamento da pasta e confirme Editor para essa conta.`,
  },
  {
    title: 'Pasta na lixeira',
    detail: 'Se alguém excluir a pasta no Drive (mesmo que ainda esteja na lixeira, recuperável), o teste e os envios passam a falhar até a pasta ser restaurada ou uma pasta nova ser configurada.',
  },
];

export default function GoogleDriveIntegrationGuide() {
  const { user } = useContext(AuthContext);

  // A tela é filtrada do menu por cargo, mas quem chegar por link direto ou
  // por histórico de navegação não pode ver o conteúdo mesmo assim.
  if (user?.role !== 'admin_geral') {
    return (
      <ScrollView contentContainerStyle={s.container}>
        <EmptyState
          title="Área restrita"
          description="Este guia é exclusivo do administrador geral da plataforma."
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Panel>
        <Text style={s.sectionTitle}>Integração com o Google Drive</Text>
        <Text style={s.sectionDescription}>
          Como ativar, para um condomínio específico, o envio de comprovantes e anexos para uma pasta do Google Drive em vez de guardá-los só no banco de dados.
        </Text>
        <View style={s.callout}>
          <Text style={s.calloutTitle}>Importante: é uma conta só para toda a plataforma</Text>
          <Text style={s.calloutText}>
            Não existe uma conta Google por condomínio nem um login separado — todos os condomínios usam a mesma credencial ({ACCOUNT_EMAIL}). O que separa os arquivos de um condomínio dos de outro é unicamente qual pasta foi compartilhada e configurada em cada cadastro. Por isso o passo de compartilhamento (2) não pode ser pulado nem feito com a conta errada.
          </Text>
        </View>
      </Panel>

      <Panel>
        <Text style={s.sectionTitle}>Passo a passo para ativar num condomínio</Text>
        {steps.map((step, index) => (
          <View key={step.title} style={s.numberedRow}>
            <View style={s.numberBadge}><Text style={s.numberBadgeText}>{index + 1}</Text></View>
            <View style={s.grow}>
              <Text style={s.stepTitle}>{step.title}</Text>
              <Text style={s.numberedText}>{step.detail}</Text>
            </View>
          </View>
        ))}
      </Panel>

      <Panel>
        <Text style={s.sectionTitle}>O que passa a acontecer depois de configurado</Text>
        {whatChanges.map(text => (
          <View key={text} style={s.bulletRow}>
            <Text style={s.bullet}>•</Text>
            <Text style={s.bulletText}>{text}</Text>
          </View>
        ))}
      </Panel>

      <Panel>
        <Text style={s.sectionTitle}>Para desativar ou trocar de pasta</Text>
        <Text style={s.paragraph}>
          Em Condomínios, apague o conteúdo do campo "Pasta do Google Drive (Prestação de Contas)" e salve — novos anexos voltam a ser guardados direto no banco de dados. Para trocar de pasta, é só colar o link da pasta nova e salvar; nada precisa ser movido manualmente.
        </Text>
        <Text style={s.disclaimer}>
          Arquivos já enviados para a pasta anterior continuam lá — desativar ou trocar a pasta não apaga nem migra nada automaticamente.
        </Text>
      </Panel>

      <Panel>
        <Text style={s.sectionTitle}>Erros comuns</Text>
        {commonErrors.map(error => (
          <View key={error.title} style={s.errorCard}>
            <Text style={s.errorTitle}>{error.title}</Text>
            <Text style={s.numberedText}>{error.detail}</Text>
          </View>
        ))}
      </Panel>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 40 },
  grow: { flex: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.ink },
  sectionDescription: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 12, lineHeight: 19 },
  paragraph: { fontSize: 14, color: colors.ink, lineHeight: 21, marginTop: 10 },
  disclaimer: { fontSize: 12, color: colors.muted, lineHeight: 18, marginTop: 12, fontStyle: 'italic' },

  callout: { backgroundColor: colors.softBlue, borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: colors.primary, marginTop: 12 },
  calloutTitle: { fontSize: 14, fontWeight: '900', color: colors.primaryDark, marginBottom: 6 },
  calloutText: { fontSize: 13, color: colors.ink, lineHeight: 20 },

  numberedRow: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-start' },
  numberBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  numberBadgeText: { fontSize: 11, fontWeight: '900', color: '#fff' },
  stepTitle: { fontSize: 14, fontWeight: '900', color: colors.ink, marginBottom: 4 },
  numberedText: { flex: 1, fontSize: 13, color: colors.ink, lineHeight: 20 },

  bulletRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  bullet: { fontSize: 14, color: colors.primary, fontWeight: '900' },
  bulletText: { flex: 1, fontSize: 13, color: colors.ink, lineHeight: 20 },

  errorCard: { borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.amber, borderRadius: 12, padding: 12, marginTop: 10 },
  errorTitle: { fontSize: 14, fontWeight: '900', color: colors.ink, marginBottom: 6 },
});
