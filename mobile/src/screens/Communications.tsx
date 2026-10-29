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
import TourButton from '../ui/TourButton';

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
type SentNotice = { id: string; title: string; body: string; audience_type: 'general' | 'personal'; source?: 'manual' | 'system'; created_at: string; created_by_name: string | null; created_by_username: string | null; recipient_count: number; read_count: number; recipients: SentRecipient[] };
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

const PAGE_SIZE = 10;
const matches = (text: string, term: string) =>
  text.toLocaleLowerCase("pt-BR").includes(term.trim().toLocaleLowerCase("pt-BR"));

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
  // Tela enxuta: compositor recolhido, abas (comunicados do síndico, avisos
  // automáticos do sistema, recebidos), cards resumidos que expandem e
  // paginação de 10 em 10.
  const [composeOpen, setComposeOpen] = useState(false);
  const [tab, setTab] = useState<"manual" | "system" | "received">("manual");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<SentNotice | null>(null);
  const toggleExpanded = (id: string) => setExpanded((current) => ({ ...current, [id]: !current[id] }));
  const changeTab = (next: typeof tab) => { setTab(next); setSearch(""); setVisibleCount(PAGE_SIZE); };
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
  const removeNotice = async () => {
    if (!deleting || !userToken) return;
    const item = deleting;
    setDeleting(null);
    try {
      await apiRequest(`/notifications/${item.id}`, userToken, { method: "DELETE" });
      setSentHistory((current) => current.filter((row) => row.id !== item.id));
      setNotices((current) => current.filter((row) => row.id !== item.id));
      emitNotificationsChanged();
    } catch (error) {
      setDialog({ visible: true, title: "Aviso não excluído", message: error instanceof Error ? error.message : "Tente novamente.", tone: "error" });
    }
  };
  const unread = notices.filter((item) => !item.read_at).length;
  const manualSent = sentHistory.filter((item) => item.source === "manual");
  const systemSent = sentHistory.filter((item) => item.source !== "manual");
  const historyList = (tab === "system" ? systemSent : manualSent).filter((item) =>
    !search.trim() || matches(item.title, search) || matches(item.body, search) || item.recipients.some((recipient) => matches(recipient.name, search)),
  );
  // Busca só aparece quando a aba tem mais de uma página de avisos.
  const currentTotal = !manager || tab === "received" ? notices.length : tab === "system" ? systemSent.length : manualSent.length;
  const noticeList = notices.filter((item) => !search.trim() || matches(item.title, search) || matches(item.body, search));
  const tabs: Array<{ key: typeof tab; label: string; count: number }> = [
    { key: "manual", label: "Comunicados", count: manualSent.length },
    { key: "system", label: "Automáticos", count: systemSent.length },
    { key: "received", label: "Recebidos", count: unread },
  ];
  const managerTourSteps: TourStep[] = [
    { key: "compose", title: "Nova comunicação", description: 'Escolha entre "Todos do condomínio" (todas as pessoas ativas) ou "Pessoa específica" (pesquise pelo nome). O título precisa ter entre 3 e 120 caracteres e a mensagem entre 3 e 2.000 caracteres. Ao enviar, o aviso já sai como notificação push pro celular de quem tiver o app com push registrado — se o destinatário não tiver nenhum aparelho registrado, o aviso fica salvo mas você recebe um alerta avisando que o push não foi entregue. Se você também tem perfil de morador neste condomínio, entra automaticamente nos envios gerais e pode selecionar a si mesmo no envio pessoal.' },
    { key: "history", title: "Histórico de envios", description: 'Os envios ficam em abas: "Comunicados" (escritos por você) e "Automáticos" (boletos, acordos, nada consta, ocorrências). Cada card mostra o resumo e o contador "X/Y leram"; toque para ver a mensagem inteira e, pessoa por pessoa, quem ainda não leu (aparece primeiro). "Excluir" remove o aviso do histórico e da caixa de entrada de todos, depois de uma confirmação.' },
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
        <View>
          <Text style={styles.eyebrow}>AVISOS DO CONDOMÍNIO</Text>
          <Text style={styles.pageTitle}>Comunicação</Text>
          <Text style={styles.subtitle}>
            Mensagens da administração para todos os moradores.
          </Text>
        </View>
        <View style={styles.heading}>
          <TourButton onPress={openTour}/>
          <View style={styles.counter}>
            <Text style={styles.counterValue}>{unread}</Text>
            <Text style={styles.counterLabel}>
              não lida{unread === 1 ? "" : "s"}
            </Text>
          </View>
        </View>
        {pushStatus !== 'registered' ? (
          <View style={styles.pushWarning}>
            <Text style={styles.pushWarningTitle}>Notificações deste aparelho: {pushStatus === 'registering' ? 'registrando...' : 'não ativas'}</Text>
            <Text style={styles.pushWarningText}>{pushError || 'Aguarde o registro do aparelho para receber avisos nativos.'}</Text>
          </View>
        ) : null}
        {manager ? (
          <View ref={registerSection('compose')} style={[isActive('compose')&&styles.tourHighlight]}>
          {!composeOpen ? (
            <View style={styles.composeTrigger}>
              <AppButton title="+ Nova comunicação" onPress={() => setComposeOpen(true)} />
            </View>
          ) : (
          <Panel>
            <View style={styles.composeHeader}>
              <Text style={styles.panelTitle}>Nova comunicação</Text>
              <Pressable onPress={() => setComposeOpen(false)}><Text style={styles.link}>Fechar</Text></Pressable>
            </View>
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
          )}
          </View>
        ) : null}
        {manager ? (
          <View style={styles.tabs}>
            {tabs.map((item) => (
              <Pressable key={item.key} onPress={() => changeTab(item.key)} style={[styles.tab, tab === item.key && styles.tabActive]}>
                <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}{item.count ? ` (${item.count})` : ""}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {currentTotal > PAGE_SIZE || search ? (
          <TextInput value={search} onChangeText={(value) => { setSearch(value); setVisibleCount(PAGE_SIZE); }} placeholder={tab === "received" || !manager ? "Buscar aviso pelo título ou texto" : "Buscar por título, texto ou destinatário"} style={styles.input} />
        ) : null}
        {manager && tab !== "received" ? <View ref={registerSection('history')} style={[isActive('history')&&styles.tourHighlight, styles.list]}>
          <Text style={styles.sectionHint}>{tab === "manual" ? "Comunicados escritos pela administração." : "Avisos gerados pelo sistema: boletos, acordos, nada consta, ocorrências."}</Text>
          {loading ? null : historyList.length === 0 ? <EmptyState title={search ? "Nada encontrado" : tab === "manual" ? "Nenhuma comunicação enviada" : "Nenhum aviso automático"} description={search ? "Tente outro termo de busca." : "Os envios ficarão registrados aqui."} /> : historyList.slice(0, visibleCount).map(item => {
            const open = !!expanded[item.id];
            const recipients = [...item.recipients].sort((a, b) => Number(!!a.read_at) - Number(!!b.read_at));
            const target = item.audience_type === 'personal' && item.recipients.length === 1 ? `Para ${item.recipients[0].name}` : 'Envio geral';
            return <View key={item.id} style={styles.sentCard}>
              <Pressable onPress={() => toggleExpanded(item.id)}>
                <View style={styles.noticeTop}><View style={styles.grow}><Text style={styles.noticeTitle} numberOfLines={open ? undefined : 1}>{item.title}</Text><Text style={styles.meta}>{target} · {dateTime(item.created_at)}{item.created_by_name || item.created_by_username ? ` · por ${item.created_by_name || item.created_by_username}` : ''}</Text></View><Text style={[styles.historyBadge, item.read_count === item.recipient_count && styles.historyBadgeRead]}>{item.read_count}/{item.recipient_count} {item.recipient_count === 1 ? 'leu' : 'leram'}</Text></View>
                <Text style={styles.noticeBody} numberOfLines={open ? undefined : 2}>{item.body}</Text>
              </Pressable>
              {open ? <View style={styles.recipientHistory}>{recipients.map(recipient => <View key={recipient.user_id} style={styles.recipientRow}><View style={styles.grow}><Text style={styles.personName}>{recipient.name}</Text><Text style={styles.personDetail}>{recipient.unit || 'Sem unidade informada'} · entregue em {dateTime(recipient.delivered_at)}</Text></View><Text style={recipient.read_at ? styles.viewedStatus : styles.pendingStatus}>{recipient.read_at ? `Visualizou em ${dateTime(recipient.read_at)}` : 'Ainda não visualizou'}</Text></View>)}</View> : null}
              <View style={styles.cardFooter}>
                <Pressable onPress={() => toggleExpanded(item.id)}><Text style={styles.link}>{open ? 'Recolher' : 'Ver mensagem e quem leu'}</Text></Pressable>
                <Pressable onPress={() => setDeleting(item)}><Text style={styles.deleteLink}>Excluir</Text></Pressable>
              </View>
            </View>;
          })}
          {historyList.length > visibleCount ? <View style={styles.moreButton}><AppButton title={`Mostrar mais (${historyList.length - visibleCount} restantes)`} variant="secondary" onPress={() => setVisibleCount((count) => count + PAGE_SIZE)} /></View> : null}
        </View> : null}
        {!manager || tab === "received" ? <View ref={registerSection('notices')} style={[isActive('notices')&&styles.tourHighlight, styles.list]}>
        {!manager ? (
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Avisos recebidos</Text>
            <Text style={styles.autoUpdate}>Atualização automática</Text>
          </View>
        ) : null}
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : noticeList.length === 0 ? (
          <EmptyState
            title={search ? "Nada encontrado" : "Nenhum aviso publicado"}
            description={search ? "Tente outro termo de busca." : "Os comunicados da administração aparecerão aqui."}
          />
        ) : (
          noticeList.slice(0, visibleCount).map((notice) => {
            const open = !!expanded[notice.id];
            return (
            <View
              key={notice.id}
              style={[styles.notice, !notice.read_at && styles.unreadNotice]}
            >
              <Pressable onPress={() => toggleExpanded(notice.id)}>
              <View style={styles.noticeTop}>
                <View style={[styles.dot, notice.read_at && styles.readDot]} />
                <View style={styles.grow}>
                  <Text style={styles.noticeTitle} numberOfLines={open ? undefined : 1}>{notice.title}</Text>
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
              <Text style={styles.noticeBody} numberOfLines={open ? undefined : 2}>{notice.body}</Text>
              </Pressable>
              <View style={styles.cardFooter}>
                <Pressable onPress={() => toggleExpanded(notice.id)}><Text style={styles.link}>{open ? 'Recolher' : 'Ler mensagem completa'}</Text></Pressable>
                {!notice.read_at ? (
                  <Pressable onPress={() => markRead(notice)}><Text style={styles.link}>Marcar como lido</Text></Pressable>
                ) : (
                  <Text style={styles.readLabel}>Lido</Text>
                )}
              </View>
            </View>
            );
          })
        )}
        {noticeList.length > visibleCount ? <View style={styles.moreButton}><AppButton title={`Mostrar mais (${noticeList.length - visibleCount} restantes)`} variant="secondary" onPress={() => setVisibleCount((count) => count + PAGE_SIZE)} /></View> : null}
        </View> : null}
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
        visible={!!deleting}
        title="Excluir este aviso?"
        message={deleting ? `"${deleting.title}" deixará de aparecer no histórico e na caixa de entrada de ${deleting.recipient_count === 1 ? "1 destinatário" : `${deleting.recipient_count} destinatários`}. Esta ação não pode ser desfeita.` : ""}
        tone="error"
        confirmLabel="Sim, excluir"
        cancelLabel="Cancelar"
        onConfirm={() => { void removeNotice(); }}
        onClose={() => setDeleting(null)}
      />
      <AppDialog
        {...dialog}
        onClose={() => setDialog((current) => ({ ...current, visible: false }))}
      />
      <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>{
        // Com as abas, a seção do passo pode estar escondida: abre antes de rolar.
        if(manager&&step.key==='compose')setComposeOpen(true);
        if(manager&&step.key==='history')changeTab('manual');
        if(manager&&step.key==='notices')changeTab('received');
        setTimeout(()=>scrollToSection(step.key),50);
      }}/>
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
  sentCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 15 },
  composeTrigger: { alignSelf: 'flex-start', minWidth: 220 },
  composeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent', marginBottom: -1 },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { color: colors.muted, fontSize: 15, fontWeight: '800' },
  tabTextActive: { color: colors.primaryDark },
  list: { gap: 10 },
  sectionHint: { color: colors.muted, fontSize: 13 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  link: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  deleteLink: { color: colors.red, fontSize: 14, fontWeight: '800' },
  moreButton: { alignSelf: 'center', minWidth: 240, marginTop: 4 },
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
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
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
    padding: 15,
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
  noticeBody: { color: "#445466", fontSize: 15, lineHeight: 21, marginTop: 8 },
  readButton: { alignSelf: "flex-end", minWidth: 150, marginTop: 14 },
  readLabel: {
    color: colors.green,
    fontSize: 13,
    fontWeight: "800",
  },
});
