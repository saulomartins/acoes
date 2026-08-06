import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiRequest } from "../api/client";
import { AuthContext } from "../context/AuthContext";
import { AppButton, AppDialog, EmptyState, Panel } from "../ui/components";
import { colors, layout } from "../ui/theme";
import { useBreakpoint } from "../ui/responsive";
type Report = {
  id: string;
  category: string;
  subject: string;
  status: "open" | "in_progress" | "resolved";
  created_at: string;
  updated_at: string;
  resident_name: string | null;
  resident_username: string;
  unit: string | null;
  unread_count: number;
};
type Message = {
  id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  sender_id: string;
  sender_name: string | null;
  sender_username: string;
  sender_role: string;
};
const labels = {
  open: "Aberto",
  in_progress: "Em atendimento",
  resolved: "Resolvido",
};
const dt = (v: string) =>
  new Date(v).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
export default function Reports({ navigation }: any) {
  const { isDesktop } = useBreakpoint();
  const { user, userToken } = useContext(AuthContext);
  const manager = ["sindico", "subsindico"].includes(user?.role || "");
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [category, setCategory] = useState("Reclamação");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [dialog, setDialog] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "info" as "info" | "success" | "error",
  });
  const load = useCallback(async () => {
    if (!userToken) return;
    try {
      const data = await apiRequest<{ reports: Report[] }>(
        "/reports",
        userToken,
      );
      setReports(data.reports);
    } catch (e) {
      setDialog({
        visible: true,
        title: "Falha ao carregar",
        message: e instanceof Error ? e.message : "Tente novamente.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [userToken]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);
  const open = async (item: Report) => {
    if (!userToken) return;
    setSelected(item);
    const data = await apiRequest<{ messages: Message[] }>(
      `/reports/${item.id}`,
      userToken,
    );
    setMessages(data.messages);
    load();
  };
  const create = async () => {
    if (!userToken) return;
    setSending(true);
    try {
      const data = await apiRequest<{ message: string }>(
        "/reports",
        userToken,
        {
          method: "POST",
          body: JSON.stringify({ category, subject, body: description }),
        },
      );
      setSubject("");
      setDescription("");
      await load();
      setDialog({
        visible: true,
        title: "Relato enviado",
        message: data.message,
        tone: "success",
      });
    } catch (e) {
      setDialog({
        visible: true,
        title: "Não foi possível enviar",
        message: e instanceof Error ? e.message : "Revise os campos.",
        tone: "error",
      });
    } finally {
      setSending(false);
    }
  };
  const answer = async () => {
    if (!userToken || !selected || reply.trim().length < 2) return;
    setSending(true);
    try {
      await apiRequest(`/reports/${selected.id}/messages`, userToken, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      await open(selected);
    } finally {
      setSending(false);
    }
  };
  const status = async (value: Report["status"]) => {
    if (!userToken || !selected) return;
    await apiRequest(`/reports/${selected.id}/status`, userToken, {
      method: "PATCH",
      body: JSON.stringify({ status: value }),
    });
    setSelected((current) => current ? { ...current, status: value } : current);
    await load();
  };
  return (
    <>
      <ScrollView contentContainerStyle={[styles.content, isDesktop && styles.desktopCap]}>
        <View>
          <Text style={styles.eyebrow}>CANAL PRIVADO</Text>
          <Text style={styles.title}>Relatos e solicitações</Text>
          <Text style={styles.subtitle}>
            {manager
              ? "Atenda relatos enviados pelos moradores do condomínio."
              : "Converse diretamente com o síndico e o subsíndico."}
          </Text>
        </View>
        {!manager ? (
          <Panel>
            <Text style={styles.panelTitle}>Novo relato</Text>
            <View style={styles.categories}>
              {[
                "Reclamação",
                "Incômodo",
                "Manutenção",
                "Sugestão",
                "Outro",
              ].map((x) => (
                <Pressable
                  key={x}
                  onPress={() => setCategory(x)}
                  style={[
                    styles.category,
                    category === x && styles.categoryActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      category === x && styles.categoryTextActive,
                    ]}
                  >
                    {x}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Assunto</Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Resuma o que aconteceu"
              style={styles.input}
            />
            <Text style={styles.label}>Descrição</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="Descreva o relato com os detalhes necessários"
              style={[styles.input, styles.area]}
            />
            <View style={styles.action}>
              <AppButton
                title={sending ? "Enviando..." : "Enviar para a administração"}
                onPress={create}
                disabled={
                  sending ||
                  subject.trim().length < 3 ||
                  description.trim().length < 3
                }
              />
            </View>
          </Panel>
        ) : null}
        <Text style={styles.sectionTitle}>
          {manager ? "Relatos dos moradores" : "Meus relatos"}
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : reports.length === 0 ? (
          <EmptyState
            title="Nenhum relato"
            description={
              manager
                ? "Nenhum morador abriu um atendimento."
                : "Se precisar falar com a administração, abra um relato acima."
            }
          />
        ) : (
          reports.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => open(item)}
              style={[
                styles.report,
                selected?.id === item.id && styles.reportSelected,
              ]}
            >
              <View style={styles.grow}>
                <Text style={styles.reportTitle}>{item.subject}</Text>
                <Text style={styles.meta}>
                  {item.category} ·{" "}
                  {manager
                    ? `${item.resident_name || item.resident_username} · ${item.unit || "Sem unidade"} · `
                    : ""}
                  {dt(item.updated_at)}
                </Text>
              </View>
              <Text
                style={[
                  styles.status,
                  item.status === "resolved" && styles.resolved,
                ]}
              >
                {labels[item.status]}
              </Text>
              {item.unread_count > 0 ? (
                <Text style={styles.unread}>{item.unread_count}</Text>
              ) : null}
            </Pressable>
          ))
        )}
        {selected ? (
          <Panel>
            <View style={styles.chatHead}>
              <View style={styles.grow}>
                <Text style={styles.panelTitle}>{selected.subject}</Text>
                <Text style={styles.meta}>
                  {manager
                    ? selected.resident_name || selected.resident_username
                    : "Conversa com a administração"}
                </Text>
              </View>
              {manager ? (
                <View style={styles.statusActions}>
                  {selected.status !== "in_progress" ? (
                    <Pressable onPress={() => status("in_progress")}>
                      <Text style={styles.link}>Atender</Text>
                    </Pressable>
                  ) : null}
                  {selected.status !== "resolved" ? (
                    <Pressable onPress={() => status("resolved")}>
                      <Text style={styles.linkGreen}>Resolver</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
            <View style={styles.chat}>
              {messages.map((message) => {
                const mine = message.sender_id === user?.id;
                return (
                  <View
                    key={message.id}
                    style={[styles.bubble, mine && styles.bubbleMine]}
                  >
                    <Text style={styles.sender}>
                      {mine
                        ? "Você"
                        : message.sender_name || message.sender_username}
                    </Text>
                    <Text style={styles.message}>{message.body}</Text>
                    <Text style={styles.messageDate}>
                      {dt(message.created_at)}
                      {mine && message.read_at ? " · visualizada" : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
            {selected.status !== "resolved" ? (
              <>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  multiline
                  placeholder="Escreva uma resposta..."
                  style={[styles.input, styles.reply]}
                />
                <View style={styles.action}>
                  <AppButton
                    title={sending ? "Enviando..." : "Responder"}
                    onPress={answer}
                    disabled={sending || reply.trim().length < 2}
                  />
                </View>
              </>
            ) : (
              <Text style={styles.closed}>
                Atendimento encerrado pela administração.
              </Text>
            )}
          </Panel>
        ) : null}
      </ScrollView>
      <AppDialog
        {...dialog}
        onClose={() => setDialog((x) => ({ ...x, visible: false }))}
      />
    </>
  );
}
const styles = StyleSheet.create({
  content: {
    width: "100%",
    alignSelf: "center",
    padding: 28,
    paddingBottom: 70,
    gap: 16,
  },
  desktopCap: { maxWidth: 860, alignSelf: "center", width: "100%" },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  title: { color: colors.ink, fontSize: 27, fontWeight: "900", marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 15, marginTop: 5 },
  panelTitle: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14 },
  category: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  categoryActive: { backgroundColor: "#eaf1fb", borderColor: colors.primary },
  categoryText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  categoryTextActive: { color: colors.primary, fontWeight: "900" },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 12,
    marginBottom: 5,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    color: colors.ink,
  },
  area: { height: 100, paddingTop: 11, textAlignVertical: "top" },
  action: { alignSelf: "flex-end", minWidth: 190, marginTop: 12 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  report: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
  },
  reportSelected: { borderColor: colors.primary, backgroundColor: "#fbfdff" },
  grow: { flex: 1 },
  reportTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  meta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  status: {
    color: "#a36700",
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: "#fff3d6",
    padding: 6,
    borderRadius: 9,
    overflow: "hidden",
  },
  resolved: { color: colors.green, backgroundColor: "#e7f7f1" },
  unread: {
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: "center",
    lineHeight: 22,
    backgroundColor: colors.red,
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },
  chatHead: { flexDirection: "row", alignItems: "center" },
  statusActions: { flexDirection: "row", gap: 12 },
  link: { color: colors.primary, fontSize: 14, fontWeight: "900" },
  linkGreen: { color: colors.green, fontSize: 14, fontWeight: "900" },
  chat: { gap: 9, marginTop: 16 },
  bubble: {
    alignSelf: "flex-start",
    maxWidth: "85%",
    backgroundColor: "#f1f4f7",
    borderRadius: 11,
    padding: 11,
  },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: "#eaf1fb" },
  sender: { color: colors.primaryDark, fontSize: 13, fontWeight: "900" },
  message: { color: colors.ink, fontSize: 15, lineHeight: 20, marginTop: 4 },
  messageDate: { color: colors.muted, fontSize: 12, marginTop: 6 },
  reply: {
    height: 75,
    paddingTop: 10,
    textAlignVertical: "top",
    marginTop: 15,
  },
  closed: {
    color: colors.green,
    fontSize: 14,
    fontWeight: "800",
    marginTop: 15,
  },
});
