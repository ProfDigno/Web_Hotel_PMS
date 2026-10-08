import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${name} es obligatorio`);
  return value.trim();
}
export function positiveInt(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new BadRequestException(`${name} debe ser un entero positivo`);
  return n;
}
export function nonNegativeGs(value: unknown, name = 'monto'): string {
  const s = String(value ?? '');
  if (!/^\d+$/.test(s)) throw new BadRequestException(`${name} debe ser un entero en guaraníes`);
  return s;
}
export function isoDate(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))
    throw new BadRequestException(`${name} debe ser AAAA-MM-DD`);
  return value;
}
export function timeHHMM(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new BadRequestException(`${name} debe ser HH:MM`);
  return value;
}
export function assertDateRange(start: string, end: string) {
  if (end <= start) throw new BadRequestException('La salida debe ser posterior a la entrada');
}
export function allowed<T extends string | number>(value: unknown, options: readonly T[], name: string): T {
  if (!options.includes(value as T)) throw new BadRequestException(`${name} no válido`);
  return value as T;
}
export function one<T>(rows: T[], what: string): T {
  if (!rows.length) throw new NotFoundException(`${what} no encontrado`);
  return rows[0];
}
export function dbError(error: unknown): never {
  const e = error as { code?: string; constraint?: string; message?: string };
  if (e.code === '23P01') throw new ConflictException('La habitación ya está reservada en esas fechas');
  if (e.code === '23505') throw new ConflictException('Ya existe un registro con ese valor');
  if (e.code === '23503') throw new BadRequestException('Existe una referencia inválida');
  throw error;
}
export function hotelDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
