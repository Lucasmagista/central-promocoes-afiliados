import type { Channel, Chat, ChatKind, ChatMessage, Destination, OutboxItem, Participant, Publication } from './types';

const MIN = 60_000, HOUR = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const uid = () => crypto.randomUUID();
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NAMES = ['Ana Paula', 'Bruno Lima', 'Carla Mendes', 'Diego Rocha', 'Eduarda S.', 'Fábio Nunes', 'Gabi Torres', 'Henrique', 'Isabela M.', 'João Pedro', 'Karina', 'Lucas T.', 'Marcela', 'Nando', 'Olívia'];
const QUESTIONS = [
  'Esse link ainda está valendo?', 'Alguém comprou? Chegou rápido?', 'O preço subiu aqui pra mim, é só eu?', 'Tem cupom pra esse também?',
  'Vale a pena esse fone ou espero mais?', 'Qual a diferença pro modelo anterior?', 'Obrigada pelas dicas, comprei ontem!', 'Frete grátis pra SP?',
  'Mandei o comprovante no privado', 'Esse vendedor é confiável?', 'Pode avisar quando baixar mais?', 'Funcionou o cupom, valeu!',
];
const THANKS = ['Valeu, entendi!', 'Perfeito, obrigada!', 'Show, vou conferir agora.'];

export interface ChatSeed { id: string; channel: Channel; external_id: string; kind: ChatKind; title: string; username: string | null; description: string | null; count: number; admin: boolean; dest: string | null; privateWith?: string }

export class DemoChats {
  chats: Chat[] = [];
  messages = new Map<string, ChatMessage[]>();
  participants = new Map<string, Participant[]>();
  outbox: OutboxItem[] = [];
  private r = rng(7);
  private seq = 1000;

  constructor(private destinations: () => Destination[], pubs: Publication[]) {
    const dTg = 'd-tg', dWa = 'd-wa', dWt = 'd-wt';
    const seeds: ChatSeed[] = [
      { id: 'c-wa1', channel: 'whatsapp', external_id: '120363000000000001@g.us', kind: 'group', title: 'Grupo Ofertas 01', username: null, description: 'Ofertas de tecnologia e casa, 6 por dia no máximo. Sem spam.', count: 214, admin: true, dest: dWa },
      { id: 'c-wa2', channel: 'whatsapp', external_id: '120363000000000002@g.us', kind: 'group', title: 'Grupo de Teste', username: null, description: 'Somente testes internos', count: 6, admin: true, dest: dWt },
      { id: 'c-wa3', channel: 'whatsapp', external_id: '120363000000000077@g.us', kind: 'group', title: 'Comunidade Promoções SP', username: null, description: 'Grupo de terceiros em que o número participa (somente leitura)', count: 1180, admin: false, dest: null },
      { id: 'c-wa4', channel: 'whatsapp', external_id: '5511987654321@s.whatsapp.net', kind: 'private', title: 'Marcela (cliente)', username: null, description: null, count: 2, admin: false, dest: null },
      { id: 'c-tg1', channel: 'telegram', external_id: '-1001234567890', kind: 'channel', title: 'Ofertas Tech BR', username: 'ofertastechbr', description: 'Canal principal de ofertas verificadas.', count: 3420, admin: true, dest: dTg },
      { id: 'c-tg2', channel: 'telegram', external_id: '-1001234567891', kind: 'group', title: 'Ofertas Tech BR — Conversa', username: 'ofertastechbr_chat', description: 'Grupo de discussão do canal.', count: 312, admin: true, dest: null },
      { id: 'c-tg3', channel: 'telegram', external_id: '4455667788', kind: 'private', title: 'Diego Rocha', username: 'diegor', description: null, count: 2, admin: false, dest: null },
    ];
    for (const sd of seeds) {
      this.chats.push({ id: sd.id, channel: sd.channel, external_id: sd.external_id, kind: sd.kind, title: sd.title, username: sd.username, description: sd.description,
        participant_count: sd.count, we_are_admin: sd.admin, destination_id: sd.dest, destination_name: null, last_message_at: null, last_message_preview: null,
        unread_count: 0, archived: false, muted: sd.id === 'c-wa3', });
      this.messages.set(sd.id, []);
      if (sd.kind !== 'private') this.participants.set(sd.id, this.makeParticipants(sd.kind === 'channel' ? 6 : Math.min(sd.count, 14), sd));
    }
    // ofertas enviadas viram mensagens de saída do destino (como o gatilho do banco faz)
    for (const p of pubs.filter((x) => x.status === 'sent')) {
      const chat = this.chats.find((c) => c.destination_id === p.destination_id); if (!chat) continue;
      this.push(chat.id, { direction: 'out', kind: 'offer', body: p.rendered_text, publication_id: p.id, sender_name: 'Central de Promoções', sent_at: p.sent_at ?? iso(-HOUR) });
    }
    // conversas de entrada ao longo de 2 dias
    for (const id of ['c-wa1', 'c-tg2', 'c-wa3']) for (let i = 0; i < 14; i++) this.fake(id, -Math.floor(this.r() * 46 * HOUR));
    this.push('c-wa4', { direction: 'in', body: 'Oi! Vi a oferta do fone no grupo, ainda tem o cupom?', sender_name: 'Marcela', sent_at: iso(-95 * MIN) });
    this.push('c-wa4', { direction: 'out', body: 'Oi, Marcela! O cupom TECH10 está na mensagem da oferta.', sender_name: 'Painel', sent_at: iso(-88 * MIN) });
    this.push('c-wa4', { direction: 'in', body: 'Funcionou, obrigada!!', sender_name: 'Marcela', sent_at: iso(-41 * MIN) });
    this.push('c-tg3', { direction: 'in', body: 'Bom dia! Posso sugerir ofertas pro canal?', sender_name: 'Diego Rocha', sent_at: iso(-5 * HOUR) });
    for (const c of this.chats) {
      const list = this.messages.get(c.id)!; list.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
      const last = list[list.length - 1]; if (last) { c.last_message_at = last.sent_at; c.last_message_preview = this.preview(last.body); }
      c.unread_count = c.muted ? 3 : list.filter((m) => m.direction === 'in' && Date.now() - new Date(m.sent_at).getTime() < 3 * HOUR).length;
    }
    this.chats.find((c) => c.id === 'c-wa2')!.unread_count = 0;
    this.sync();
  }

  private preview(b: string) { return b.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140); }
  private makeParticipants(n: number, sd: ChatSeed): Participant[] {
    const out: Participant[] = [{ external_id: 'owner', display_name: 'Lucas Magista (você)', role: 'owner', joined_at: iso(-60 * 24 * HOUR) }];
    for (let i = 0; i < n - 1; i++) out.push({ external_id: `u${sd.id}${i}`, display_name: NAMES[i % NAMES.length], role: i < 2 ? 'admin' : 'member', joined_at: iso(-Math.floor(this.r() * 50 * 24) * HOUR) });
    return out;
  }
  private fake(chatId: string, offsetMs: number) {
    const name = NAMES[Math.floor(this.r() * NAMES.length)];
    this.push(chatId, { direction: 'in', body: QUESTIONS[Math.floor(this.r() * QUESTIONS.length)], sender_name: name, sender_external_id: name, sent_at: iso(offsetMs) });
  }
  private push(chatId: string, m: Partial<ChatMessage> & { direction: 'in' | 'out'; body: string }): ChatMessage {
    const msg: ChatMessage = { id: uid(), chat_id: chatId, external_id: String(++this.seq), sender_name: null, sender_external_id: null, kind: 'text', reply_to: null, publication_id: null, outbox_id: null, sent_at: iso(0), ...m };
    this.messages.get(chatId)!.push(msg); return msg;
  }
  /** Grupos que existem no celular/Telegram mas ainda não foram sincronizados com o painel. */
  hidden: ChatSeed[] = [
    { id: 'h-wa1', channel: 'whatsapp', external_id: '120363000000000101@g.us', kind: 'group', title: 'Ofertas Carro SP', username: null, description: 'Criado pelo celular', count: 48, admin: true, dest: null },
    { id: 'h-wa2', channel: 'whatsapp', external_id: '120363000000000102@g.us', kind: 'group', title: 'Casa e Decoração Brasil', username: null, description: null, count: 120, admin: true, dest: null },
    { id: 'h-wa3', channel: 'whatsapp', external_id: '120363000000000103@g.us', kind: 'group', title: 'Churrasco da turma', username: null, description: null, count: 22, admin: false, dest: null },
    { id: 'h-tg1', channel: 'telegram', external_id: '-1001999000111', kind: 'channel', title: 'Promos Games BR', username: 'promosgamesbr', description: null, count: 860, admin: true, dest: null },
    { id: 'h-tg2', channel: 'telegram', external_id: '-1001999000222', kind: 'group', title: 'Achadinhos Casa', username: null, description: null, count: 95, admin: false, dest: null },
  ];
  private add(sd: ChatSeed) {
    if (this.chats.some((c) => c.channel === sd.channel && c.external_id === sd.external_id)) return null;
    const chat: Chat = { id: sd.id, channel: sd.channel, external_id: sd.external_id, kind: sd.kind, title: sd.title, username: sd.username, description: sd.description,
      participant_count: sd.count, we_are_admin: sd.admin, destination_id: sd.dest, destination_name: null, last_message_at: null, last_message_preview: null, unread_count: 0, archived: false, muted: false };
    this.chats.push(chat); this.messages.set(chat.id, []);
    if (sd.kind !== 'private') this.participants.set(chat.id, this.makeParticipants(Math.min(sd.count, 14), sd));
    return chat;
  }
  /** Simula o n8n sincronizando todos os grupos conhecidos do canal. */
  reveal(channel: Channel) { let n = 0; for (const h of this.hidden.filter((x) => x.channel === channel)) if (this.add(h)) n++; return n; }
  createGroup(channel: Channel, title: string, description: string, people: { external_id: string; display_name: string }[]) {
    const sd: ChatSeed = { id: uid(), channel, external_id: `1203630000${Math.floor(Math.random() * 1e8)}@g.us`, kind: 'group', title, username: null, description: description || null, count: people.length + 1, admin: true, dest: null };
    const c = this.add(sd)!;
    this.participants.set(c.id, [{ external_id: 'owner', display_name: 'Lucas Magista (você)', role: 'owner', joined_at: iso(0) }, ...people.map((p) => ({ external_id: p.external_id, display_name: p.display_name, role: 'member' as const, joined_at: iso(0) }))]);
    return c;
  }
  addVerified(channel: Channel, ref: string, admin: boolean) {
    const name = ref.replace('@', '');
    return this.add({ id: uid(), channel, external_id: ref.startsWith('@') ? `-100${Math.floor(Math.random() * 1e10)}` : ref, kind: 'channel', title: ref.startsWith('@') ? name : `Canal ${ref}`, username: ref.startsWith('@') ? name : null, description: null, count: 150, admin, dest: null });
  }
  contacts(channel: Channel, q?: string) {
    const m = new Map<string, string>();
    for (const c of this.chats.filter((x) => x.channel === channel)) {
      if (c.kind === 'private') m.set(c.external_id, c.title);
      for (const p of this.participants.get(c.id) ?? []) if (p.role !== 'owner') m.set(p.external_id.includes('@') || channel === 'telegram' ? p.external_id : `5511${String(900000000 + (p.external_id.length * 7919 + (p.display_name ?? '').length * 104729) % 99999999)}@s.whatsapp.net`, p.display_name ?? p.external_id);
    }
    return [...m].map(([external_id, display_name]) => ({ external_id, display_name })).filter((x) => !q || (x.display_name + x.external_id).toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.display_name.localeCompare(b.display_name));
  }
  sync() { for (const c of this.chats) c.destination_name = this.destinations().find((d) => d.id === c.destination_id)?.name ?? null; }

  /** Chamado pelo "worker" simulado a cada ciclo. */
  tick(paused: boolean) {
    if (this.r() < 0.35) {
      const open = this.chats.filter((c) => !c.archived && c.kind !== 'private' && c.id !== 'c-wa2' && c.we_are_admin !== undefined);
      const c = open[Math.floor(this.r() * open.length)];
      this.fake(c.id, 0); this.touch(c, 'in');
    }
    if (!paused) {
      const o = this.outbox.find((x) => x.status === 'pending');
      if (o) {
        o.status = 'sent'; o.sent_at = iso(0);
        const c = this.chats.find((x) => x.id === o.chat_id)!;
        this.push(c.id, { direction: 'out', body: o.body, outbox_id: o.id, sender_name: 'Painel' }); this.touch(c, 'out');
        if (c.kind === 'private' && this.r() < 0.6) { setTimeout(() => { this.push(c.id, { direction: 'in', body: THANKS[Math.floor(this.r() * THANKS.length)], sender_name: c.title.split(' (')[0] }); this.touch(c, 'in'); }, 4000); }
      }
    }
  }
  private touch(c: Chat, dir: 'in' | 'out') {
    const last = this.messages.get(c.id)!.slice(-1)[0];
    c.last_message_at = last.sent_at; c.last_message_preview = this.preview(last.body); if (dir === 'in') c.unread_count += 1;
  }
  queue(chatId: string, text: string, banned: string[]): OutboxItem {
    const c = this.chats.find((x) => x.id === chatId); if (!c) throw new Error('Conversa inexistente');
    const t = text.trim(); if (!t) throw new Error('Mensagem vazia');
    const limit = c.channel === 'telegram' ? 4096 : 4000; if (t.length > limit) throw new Error(`Mensagem maior que ${limit} caracteres`);
    const v = banned.filter((b) => new RegExp(`(^|[^\\p{L}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(t));
    if (v.length) throw new Error(`Texto contém termos proibidos: ${v.join(', ')}`);
    if (c.kind === 'channel' && !c.we_are_admin) throw new Error('Não somos administradores deste canal');
    if (this.outbox.filter((o) => o.chat_id === chatId && ['pending', 'claimed'].includes(o.status)).length >= 5) throw new Error('Há mensagens demais aguardando envio nesta conversa');
    const o: OutboxItem = { id: uid(), chat_id: chatId, body: t, status: 'pending', last_error: null, created_at: iso(0), sent_at: null };
    this.outbox.push(o); return o;
  }
}
