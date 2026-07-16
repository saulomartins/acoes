import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiRequest } from "../api/client";
import { AuthContext } from "../context/AuthContext";
import { AppButton, AppDialog, EmptyState, Panel } from "../ui/components";
import ResponsiveShell from "../ui/ResponsiveShell";
import { colors, layout } from "../ui/theme";
import { emitNotificationsChanged } from "../services/notificationEvents";

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
  const { user, userToken } = useContext(AuthContext);
  const manager = user?.role === "sindico" || user?.role === "subsindico";
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
        setPeople(data.users.filter((item) => item.id !== user?.id)),
      )
      .catch(() => setPeople([]));
  }, [manager, user?.id, userToken]);
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
      const data = await apiRequest<{ message: string }>(
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
        message: data.message,
        tone: "success",
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
  return (
    <ResponsiveShell activeRoute="Communications" navigation={navigation}>
      <ScrollView
        contentContainerStyle={styles.content}
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
          <View>
            <Text style={styles.eyebrow}>AVISOS DO CONDOMÍNIO</Text>
            <Text style={styles.pageTitle}>Comunicação</Text>
            <Text style={styles.subtitle}>
              Mensagens da administração para todos os moradores.
            </Text>
          </View>
          <View style={styles.counter}>
            <Text style={styles.counterValue}>{unread}</Text>
            <Text style={styles.counterLabel}>
              não lida{unread === 1 ? "" : "s"}
            </Text>
          </View>
        </View>
        {manager ? (
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
                        {selectedPerson.full_name || selectedPerson.username}
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
                          {person.full_name || person.username}
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
        ) : null}
        {manager ? <>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Histórico de envios</Text>
            <Text style={styles.autoUpdate}>{sentHistory.length} envio{sentHistory.length === 1 ? '' : 's'}</Text>
          </View>
          {loading ? null : sentHistory.length === 0 ? <EmptyState title="Nenhuma comunicação enviada" description="Os envios gerais e pessoais ficarão registrados aqui." /> : sentHistory.map(item => <View key={item.id} style={styles.sentCard}>
            <View style={styles.noticeTop}><View style={styles.grow}><Text style={styles.noticeTitle}>{item.title}</Text><Text style={styles.meta}>{item.audience_type === 'general' ? 'Envio geral' : 'Envio pessoal'} · {dateTime(item.created_at)} · por {item.created_by_name || item.created_by_username}</Text></View><Text style={[styles.historyBadge, item.read_count === item.recipient_count && styles.historyBadgeRead]}>{item.read_count}/{item.recipient_count} visualizaram</Text></View>
            <Text style={styles.noticeBody}>{item.body}</Text>
            <View style={styles.recipientHistory}>{item.recipients.map(recipient => <View key={recipient.user_id} style={styles.recipientRow}><View style={styles.grow}><Text style={styles.personName}>{recipient.name}</Text><Text style={styles.personDetail}>{recipient.unit || 'Sem unidade informada'} · entregue em {dateTime(recipient.delivered_at)}</Text></View><Text style={recipient.read_at ? styles.viewedStatus : styles.pendingStatus}>{recipient.read_at ? `Visualizou em ${dateTime(recipient.read_at)}` : 'Ainda não visualizou'}</Text></View>)}</View>
          </View>)}
        </> : null}
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
            ? "Todas as pessoas ativas deste condomínio receberão esta mensagem no aplicativo."
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
    </ResponsiveShell>
  );
}
const styles = StyleSheet.create({
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
    maxWidth: layout.contentMaxWidth,
    alignSelf: "center",
    padding: 28,
    gap: 18,
    paddingBottom: 70,
  },
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
