import { Badge } from './ui';
import { connectorModeLabel, offerStatusLabel, pubStatusLabel, platformName, channelName } from '../lib/format';
import { Send, MessageCircle } from 'lucide-react';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'accent' | undefined;
const offerTone: Record<string, Tone> = { needs_review: 'warn', scheduled: 'info', published: 'ok', rejected: 'bad', expired: undefined, approved: 'info', discovered: undefined };
const pubTone: Record<string, Tone> = { pending: 'info', claimed: 'info', sent: 'ok', retry_scheduled: 'warn', failed_permanent: 'bad', unknown: 'bad', cancelled: undefined };
const connTone: Record<string, Tone> = { disabled: undefined, manual_only: 'info', api_pending: 'warn', api_ready: 'ok', paused_policy: 'bad', error: 'bad' };

export const OfferStatus = ({ s }: { s: string }) => <Badge tone={offerTone[s]}>{offerStatusLabel[s] ?? s}</Badge>;
export const PubStatus = ({ s }: { s: string }) => <Badge tone={pubTone[s]}>{pubStatusLabel[s] ?? s}</Badge>;
export const ConnectorMode = ({ s }: { s: string }) => <Badge tone={connTone[s]}>{connectorModeLabel[s] ?? s}</Badge>;
export const PlatformTag = ({ p }: { p: string }) => <Badge tone="accent">{platformName[p] ?? p}</Badge>;
export const ChannelTag = ({ c }: { c: string }) => <Badge>{c === 'telegram' ? <Send size={12} /> : <MessageCircle size={12} />}{channelName[c] ?? c}</Badge>;
export const Score = ({ v }: { v: number | null }) => v == null ? <span className="muted">—</span> :
  <span className={`score ${v >= 75 ? 'hi' : v >= 50 ? 'mid' : 'lo'}`} title={`Score ${v}/100`}>{v}</span>;
