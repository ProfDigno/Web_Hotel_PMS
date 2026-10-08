import { BedDouble, Users, Trash2, Eye, Wrench, Clock3 } from 'lucide-react';

type RoomState = 'available' | 'occupied' | 'overdue' | 'dirty' | 'cleaning' | 'inspection' | 'out-of-service';
type RoomStatus = { fuera_servicio?: boolean; en_casa?: boolean; estado_limpieza?: string; fecha_salida?: string | null; hora_checkout?: string | null };

export function isCheckoutOverdue(room: RoomStatus, now = new Date()): boolean {
  if (!room.en_casa || !/^\d{4}-\d{2}-\d{2}$/.test(room.fecha_salida || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(room.hora_checkout || '')) return false;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  const localNow = `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
  return localNow >= `${room.fecha_salida}T${room.hora_checkout}`;
}

export function roomVisualState(room: RoomStatus, now = new Date()): RoomState {
  if (room.fuera_servicio) return 'out-of-service';
  if (isCheckoutOverdue(room, now)) return 'overdue';
  if (room.estado_limpieza === 'sucia') return 'dirty';
  if (room.estado_limpieza === 'en_limpieza') return 'cleaning';
  if (room.estado_limpieza === 'inspeccion') return 'inspection';
  return room.en_casa ? 'occupied' : 'available';
}

function Broom({ size = 23 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m14 10 6-7M12 9l4 3-2 3-5-4zM9 11c-3 1-4 4-5 7l8 4c0-3 1-6 2-7M7 17l-1 2M10 18l-1 3"/>
  </svg>;
}

export function RoomStateIcon({ room, now }: { room: RoomStatus; now?: Date }) {
  const state = roomVisualState(room, now);
  const Icon = { available: BedDouble, occupied: Users, overdue: Clock3, dirty: Trash2, cleaning: Broom, inspection: Eye, 'out-of-service': Wrench }[state];
  return <Icon size={23} aria-hidden="true"/>;
}
