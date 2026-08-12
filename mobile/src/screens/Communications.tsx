import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text, TextInput } from "../ui/text";
import { apiRequest } from "../api/client";
import { AuthContext } from "../context/AuthContext";
import { AppButton, AppDialog, EmptyState, Panel } from "../ui/components";
import { colors, layout } from "../ui/theme";
import { useBreakpoint } from "../ui/responsive";
import { emitNotificationsChanged } from "../services/notificationEvents";
import FeatureTour, { type TourStep } from "../ui/FeatureTour";
import { useSectionTour } from "../ui/useSectionTour";

type Notice = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  created_by_name: string | null;
  created_by_username: string | null;
  read_at: string | null;
};
type Person = {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
  unit: string | null;
};
type SentRecipient = { user_id: string; name: string; unit: string | null; delivered_at: string; read_at: string | null };
type SentNotice = { id: string; title: string; body: string; audience_type: 'general' | 'personal'; created_at: string; created_by_name: string | null; created_by_username: string | null; recipient_count: number; read_count: number; recipients: SentRecipient[] };
type DialogState = {
  visible: boolean;
  title: string;
  message: string;
  tone: "info" | "success" | "error";
};
const dateTime = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function Communications({ navigation }: any) {
  const { isDesktop } = useBreakpoint();
  const { user, userToken, pushStatus, pushError, profiles } = useContext(AuthContext);
  const manager = user?.role === "sindico" || user?.role === "subsindico";
  // Síndico/subsíndico que também é morador deste condomínio recebe os próprios
  // comunicados e pode se escolher no envio pessoal — a API aplica a mesma regra
  // em POST /notifications. `profiles` já traz o perfil padrão e os extras.
  const senderIsResident = profiles.some(
    (profile) =>
      profile.condominiumId === user?.condominiumId &&
      (profile.role === "proprietario" || profile.role === "inquilino"),
  );
  const {scrollRef,tourOpen,registerSection,scrollToSection,openTour,closeTour,isActive}=useSectionTour();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [sentHistory, setSentHistory] = useState<SentNotice[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"general" | "personal">("general");
  const [people, setPeople] = useState<Person[]>([]);
  const [personSearch, setPersonSearch] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({
    visible: false,
    title: "",
    message: "",
    tone: "info",
  });
  const load = useCallback(
    async (silent = false) => {
      if (!userToken) return;
      if (!silent) setLoading(true);
      try {
        const receivedRequest = apiRequest<{ notifications: Notice[] }>("/notifications", userToken);
        const sentRequest = manager ? apiRequest<{ history: SentNotice[] }>("/notifications/history/sent", userToken) : Promise.resolve({ history: [] });
        const [received, sent] = await Promise.all([receivedRequest, sentRequest]);
        setNotices(received.notifications);
        setSentHistory(sent.history);
      } catch (error) {
        if (!silent)
          setDialog({
            visible: true,
            title: "Não foi possível carregar",
            message:
              error instanceof Error ? error.message : "Tente novamente.",
            tone: "error",
          });
      } finally {
        if (!silent) setLoading(false);
        setRefreshing(false);
      }
    },
    [manager, userToken],
  );
  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!manager || !userToken) return;
    apiRequest<{ users: Person[] }>("/users", userToken)
      .then((data) =>
        setPeople(
          data.users.filter((item) => item.id !== user?.id || senderIsResident),
        ),
      )
      .catch(() => setPeople([]));
  }, [manager, senderIsResident, user?.id, userToken]);
  const personLabel = (person: Person) =>
    `${person.full_name || person.username}${person.id === user?.id ? " (você)" : ""}`;
  const visiblePeople = people
    .filter((item) =>
      (item.full_name || item.username)
        .toLocaleLowerCase("pt-BR")
        .includes(personSearch.trim().toLocaleLowerCase("pt-BR")),
    )
    .slice(0, 8);
  const requestSend = () => {
    if (audience === "personal" && !selectedPerson) {
      setDialog({
        visible: true,
        title: "Selecione uma pessoa",
        message: "Pesquise pelo nome e selecione quem receberá a mensagem.",
        tone: "error",
      });
      return;
    }
    if (title.trim().length < 3 || body.trim().length < 3) {
      setDialog({
        visible: true,
        title: "Preencha o aviso",
        message: "Informe um título e uma mensagem para os moradores.",
        tone: "error",
      });
      return;
    }
    setConfirming(true);
  };
  const send = async () => {
    if (!userToken) return;
    setConfirming(false);
    setSending(true);
    try {
      const data = await apiRequest<{ message: string; push: { status: string; requested: number; delivered: number; errors?: string[] } }>(
        "/notifications",
        userToken,
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            body: body.trim(),
            targetUserId: audience === "personal" ? selectedPerson?.id : null,
          }),
        },
      );
      setTitle("");
      setBody("");
      setSelectedPerson(null);
      setPersonSearch("");
      await load(true);
      setDialog({
        visible: true,
        title: "Mensagem enviada",
        message: data.push.requested === 0
          ? `${data.message}\n\nNenhum aparelho esta registrado para o destinatario. Ele precisa entrar no app e permitir notificacoes.`
          : data.push.delivered === 0
            ? `${data.message}\n\nO aviso ficou salvo, mas o push nativo falhou: ${data.push.errors?.join(', ') || 'falha no provedor Expo'}.`
            : `${data.message}\n\nPush aceito pelo Expo para ${data.push.delivered} aparelho(s).`,
        tone: data.push.requested > 0 && data.push.delivered === 0 ? "error" : "success",
      });
    } catch (error) {
      setDialog({
        visible: true,
        title: "Mensagem não enviada",
        message: error instanceof Error ? error.message : "Tente novamente.",
        tone: "error",
      });
    } finally {
      setSending(false);
    }
  };
  const markRead = async (notice: Notice) => {
    if (!userToken || notice.read_at) return;
    setNotices((current) => current.filter((item) => item.id !== notice.id));
    emitNotificationsChanged();
    try {
      await apiRequest(`/notifications/${notice.id}/read`, userToken, {
        method: "PATCH",
      });
      emitNotificationsChanged();
    } catch {
      load(true);
      emitNotificationsChanged();
    }
  };
  const unread = notices.filter((item) => !item.read_at).length;
  const managerTourSteps: TourStep[] = [
    { key: "compose", title: "Nova comunicação", description: 'Escolha entre "Todos do condomínio" (todas as pessoas ativas) ou "Pessoa específica" (pesquise pelo nome). O título precisa ter entre 3 e 120 caracteres e a mensagem entre 3 e 2.000 caracteres. Ao enviar, o aviso já sai como notificação push pro celular de quem tiver o app com push registrado — se o destinatário não tiver nenhum aparelho registrado, o aviso fica salvo mas você recebe um alerta avisando que o push não foi entregue. Se você também tem perfil de morador neste condomínio, entra automaticamente nos envios gerais e pode selecionar a si mesmo no envio pessoal.' },
    { key: "history", title: "Histórico de envios", description: 'Cada card é um envio (geral ou pessoal) com o total de destinatários e o contador "X/Y visualizaram". Expanda a lista de destinatários pra ver, pessoa por pessoa, quando o aviso foi entregue e se/quando cada um leu — dá pra cobrar quem ainda não visualizou um comunicado importante.' },
    { key: "notices", title: "Avisos recebidos", description: 'Sua própria caixa de entrada de avisos, inclusive os que outro síndico/subsíndico te enviar. Avisos não lidos aparecem com uma barra azul à esquerda e a etiqueta "NOVO"; toque em "Marcar como lido" pra confirmar a leitura — isso também atualiza o contador de visualizações no histórico de quem enviou.' },
  ];
  const residentTourSteps: TourStep[] = [
    { key: "notices", title: "Avisos recebidos", description: 'Aqui aparecem os avisos gerais (para todo o condomínio) e os pessoais que o síndico ou subsíndico te enviarem. Os não lidos têm uma barra azul à esquerda e a etiqueta "NOVO"; toque em "Marcar como lido" quando terminar de ler — a administração consegue ver no histórico dela que você visualizou.' },
  ];
  const tourSteps = manager ? managerTourSteps : residentTourSteps;
  return (
    <>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, isDesktop && styles.desktopCap]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
          />
        }
      >
        <View style={styles.heading}>
          <View style={styles.grow}>
            <View style={styles.headerRow}>
              <View style={styles.grow}>
                <Text style={styles.eyebrow}>AVISOS DO CONDOMÍNIO</Text>
                <Text style={styles.pageTitle}>Comunicação</Text>
                <Text style={styles.subtitle}>
                  Mensagens da administração para todos os moradores.
                </Text>
              </View>
              <Pressable onPress={openTour} style={styles.tourButton}>
                <Text style={styles.tourButtonText}>? Tour desta tela</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.counter}>
            <Text style={styles.counterValue}>{unread}</Text>
            <Text style={styles.counterLabel}>
              não lida{unread === 1 ? "" : "s"}
            </Text>
          </View>
        </View>
        {pushStatus !== 'registered' ? (
          <View style={styles.pushWarning}>
            <Text style={styles.pushWarningTitle}>Notificacoes deste aparelho: {pushStatus === 'registering' ? 'registrando...' : 'nao ativas'}</Text>
            <Text style={styles.pushWarningText}>{pushError || 'Aguarde o registro do aparelho para receber avisos nativos.'}</Text>
          </View>
        ) : null}
        {manager ? (
          <View ref={registerSection('compose')} style={[isActive('compose')&&styles.tourHighlight]}>
          <Panel>
            <Text style={styles.panelTitle}>Nova comunicação</Text>
            <Text style={styles.hint}>
              Escolha se a mensagem será geral ou destinada a uma única pessoa.
            </Text>
            <View style={styles.audienceRow}>
              <Pressable
                onPress={() => {
                  setAudience("general");
                  setSelectedPerson(null);
                }}
                style={[
                  styles.audienceOption,
                  audience === "general" && styles.audienceActive,
                ]}
              >
                <Text
                  style={[
                    styles.audienceText,
                    audience === "general" && styles.audienceTextActive,
                  ]}
                >
                  Todos do condomínio
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAudience("personal")}
                style={[
                  styles.audienceOption,
                  audience === "personal" && styles.audienceActive,
                ]}
              >
                <Text
                  style={[
                    styles.audienceText,
                    audience === "personal" && styles.audienceTextActive,
                  ]}
                >
                  Pessoa específica
                </Text>
              </Pressable>
            </View>
            {audience === "personal" ? (
              <View>
                <Text style={styles.label}>Pesquisar pessoa</Text>
                <TextInput
                  value={personSearch}
                  onChangeText={(value) => {
                    setPersonSearch(value);
                    setSelectedPerson(null);
                  }}
                  placeholder="Digite o nome da pessoa"
                  style={styles.input}
                />
                {selectedPerson ? (
                  <View style={styles.selectedPerson}>
                    <View style={styles.grow}>
                      <Text style={styles.personName}>
                        {personLabel(selectedPerson)}
                      </Text>
                      <Text style={styles.personDetail}>
                        {selectedPerson.unit || "Sem unidade informada"}
                      </Text>
                    </View>
                    <Pressable onPress={() => setSelectedPerson(null)}>
                      <Text style={styles.changePerson}>Alterar</Text>
                    </Pressable>
                  </View>
                ) : personSearch.trim().length > 0 ? (
                  <View style={styles.peopleList}>
                    {visiblePeople.map((person) => (
                      <Pressable
                        key={person.id}
                        onPress={() => {
                          setSelectedPerson(person);
                          setPersonSearch(person.full_name || person.username);
                        }}
                        style={styles.personOption}
                      >
                        <Text style={styles.personName}>
                          {personLabel(person)}
                        </Text>
                        <Text style={styles.personDetail}>
                          {person.unit || "Sem unidade informada"}
                        </Text>
                      </Pressable>
                    ))}
                    {visiblePeople.length === 0 ? (
                      <Text style={styles.noPerson}>
                        Nenhuma pessoa encontrada.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text style={styles.label}>Título</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              placeholder="Ex.: Manutenção programada"
              style={styles.input}
            />
            <Text style={styles.label}>Mensagem</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              maxLength={2000}
              multiline
              placeholder="Digite aqui as informações do comunicado..."
              style={[styles.input, styles.messageInput]}
            />
            <View style={styles.sendRow}>
              <Text style={styles.characters}>
                {body.length}/2.000 caracteres
              </Text>
              <View style={styles.button}>
                <AppButton
                  title={
                    sending
                      ? "Enviando..."
                      : audience === "general"
                        ? "Enviar para todos"
                        : "Enviar para a pessoa"
                  }
                  onPress={requestSend}
                  disabled={sending}
                />
              </View>
            </View>
          </Panel>
          </View>
        ) : null}
        {manager ? <View ref={registerSection('history')} style={[isActive('history')&&styles.tourHighlight]}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Histórico de envios</Text>
            <Text style={styles.autoUpdate}>{sentHistory.length} envio{sentHistory.length === 1 ? '' : 's'}</Text>
          </View>
          {loading ? null : sentHistory.length === 0 ? <EmptyState title="Nenhuma comunicação enviada" description="Os envios gerais e pessoais ficarão registrados aqui." /> : sentHistory.map(item => <View key={item.id} style={styles.sentCard}>
            <View style={styles.noticeTop}><View style={styles.grow}><Text style={styles.noticeTitle}>{item.title}</Text><Text style={styles.meta}>{item.audience_type === 'general' ? 'Envio geral' : 'Envio pessoal'} · {dateTime(item.created_at)} · por {item.created_by_name || item.created_by_username}</Text></View><Text style={[styles.historyBadge, item.read_count === item.recipient_count && styles.historyBadgeRead]}>{item.read_count}/{item.recipient_count} visualizaram</Text></View>
            <Text style={styles.noticeBody}>{item.body}</Text>
            <View style={styles.recipientHistory}>{item.recipients.map(recipient => <View key={recipient.user_id} style={styles.recipientRow}><View style={styles.grow}><Text style={styles.personName}>{recipient.name}</Text><Text style={styles.personDetail}>{recipient.unit || 'Sem unidade informada'} · entregue em {dateTime(recipient.delivered_at)}</Text></View><Text style={recipient.read_at ? styles.viewedStatus : styles.pendingStatus}>{recipient.read_at ? `Visualizou em ${dateTime(recipient.read_at)}` : 'Ainda não visualizou'}</Text></View>)}</View>
          </View>)}
        </View> : null}
        <View ref={registerSection('notices')} style={[isActive('notices')&&styles.tourHighlight]}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Avisos recebidos</Text>
          <Text style={styles.autoUpdate}>Atualização automática</Text>
        </View>
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : notices.length === 0 ? (
          <EmptyState
            title="Nenhum aviso publicado"
            description="Os comunicados da administração aparecerão aqui."
          />
        ) : (
          notices.map((notice) => (
            <View
              key={notice.id}
              style={[styles.notice, !notice.read_at && styles.unreadNotice]}
            >
              <View style={styles.noticeTop}>
                <View style={[styles.dot, notice.read_at && styles.readDot]} />
                <View style={styles.grow}>
                  <Text style={styles.noticeTitle}>{notice.title}</Text>
                  <Text style={styles.meta}>
                    {notice.created_by_name ||
                      notice.created_by_username ||
                      "Administração"}{" "}
                    · {dateTime(notice.created_at)}
                  </Text>
                </View>
                {!notice.read_at ? (
                  <Text style={styles.newBadge}>NOVO</Text>
                ) : null}
              </View>
              <Text style={styles.noticeBody}>{notice.body}</Text>
              {!notice.read_at ? (
                <View style={styles.readButton}>
                  <AppButton
                    title="Marcar como lido"
                    variant="secondary"
                    onPress={() => markRead(notice)}
                  />
                </View>
              ) : (
                <Text style={styles.readLabel}>Lido</Text>
              )}
            </View>
          ))
        )}
        </View>
      </ScrollView>
      <AppDialog
        visible={confirming}
        title={
          audience === "general"
            ? "Enviar para todos?"
            : "Enviar mensagem pessoal?"
        }
        message={
          audience === "general"
            ? senderIsResident
              ? "Todas as pessoas ativas deste condomínio receberão esta mensagem no aplicativo — incluindo você, que também tem perfil de morador."
              : "Todas as pessoas ativas deste condomínio receberão esta mensagem no aplicativo."
            : selectedPerson?.id === user?.id
              ? "Você será a única pessoa a receber esta mensagem."
              : `${selectedPerson?.full_name || selectedPerson?.username} será a única pessoa a receber esta mensagem.`
        }
        confirmLabel="Sim, enviar"
        cancelLabel="Revisar"
        onConfirm={send}
        onClose={() => setConfirming(false)}
      />
      <AppDialog
        {...dialog}
        onClose={() => setDialog((current) => ({ ...current, visible: false }))}
      />
      <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>scrollToSection(step.key)}/>
    </>
  );
}
const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  pushWarning: { backgroundColor: '#fff3d6', borderWidth: 1, borderColor: '#e9c46a', borderRadius: 10, padding: 13 },
  pushWarningTitle: { color: '#7a4d00', fontSize: 14, fontWeight: '900' },
  pushWarningText: { color: '#7a4d00', fontSize: 13, marginTop: 4 },
  sentCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 17 },
  historyBadge: { color: '#9a6700', backgroundColor: '#fff3d6', borderRadius: 9, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, fontSize: 12, fontWeight: '900' },
  historyBadgeRead: { color: colors.green, backgroundColor: '#e7f7f1' },
  recipientHistory: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  viewedStatus: { color: colors.green, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  pendingStatus: { color: '#a36700', fontSize: 13, fontWeight: '800', textAlign: 'right' },
  audienceRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  audienceOption: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  audienceActive: { backgroundColor: '#eaf1fb', borderColor: colors.primary },
  audienceText: { color: colors.muted, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  audienceTextActive: { color: colors.primaryDark },
  peopleList: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: 5, overflow: 'hidden' },
  personOption: { padding: 11, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: '#fff' },
  selectedPerson: { flexDirection: 'row', alignItems: 'center', marginTop: 7, padding: 11, borderRadius: 8, backgroundColor: '#eaf1fb' },
  personName: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  personDetail: { color: colors.muted, fontSize: 13, marginTop: 3 },
  changePerson: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  noPerson: { color: colors.muted, fontSize: 14, padding: 12 },
  content: {
    width: "100%",
    alignSelf: "center",
    padding: 28,
    gap: 18,
    paddingBottom: 70,
  },
  desktopCap: { maxWidth: 860, alignSelf: "center", width: "100%" },
  heading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  pageTitle: {
    color: colors.ink,
    fontSize: 27,
    fontWeight: "900",
    marginTop: 5,
  },
  subtitle: { color: colors.muted, fontSize: 16, marginTop: 5 },
  counter: {
    minWidth: 92,
    maxWidth: "100%",
    backgroundColor: "#eaf1fb",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    alignSelf: "flex-start",
  },
  counterValue: { color: colors.primary, fontSize: 22, fontWeight: "900" },
  counterLabel: { color: colors.primaryDark, fontSize: 13, fontWeight: "800", textAlign: "center" },
  panelTitle: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  hint: { color: colors.muted, fontSize: 14, marginTop: 5, marginBottom: 14 },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    color: colors.ink,
    fontSize: 16,
  },
  messageInput: { minHeight: 112, paddingTop: 12, textAlignVertical: "top" },
  sendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 14,
  },
  characters: { color: colors.muted, fontSize: 13 },
  button: { minWidth: 170 },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  listTitle: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  autoUpdate: { color: colors.green, fontSize: 13, fontWeight: "800" },
  notice: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.radius,
    padding: 17,
  },
  unreadNotice: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    backgroundColor: "#fbfdff",
  },
  noticeTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 5,
  },
  readDot: { backgroundColor: "#c5ced7" },
  grow: { flex: 1 },
  noticeTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  meta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  newBadge: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: "#eaf1fb",
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
  },
  noticeBody: { color: "#445466", fontSize: 16, lineHeight: 22, marginTop: 13 },
  readButton: { alignSelf: "flex-end", minWidth: 150, marginTop: 14 },
  readLabel: {
    alignSelf: "flex-end",
    color: colors.green,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 12,
  },
});
