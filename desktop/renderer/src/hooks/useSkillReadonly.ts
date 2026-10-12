import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZodType } from 'zod';
import { api } from '../api';
import { useLocale } from '../contexts/LocaleContext';
import { SKILL_LIST_OUTPUT_SCHEMA } from '../../../shared/skill-list-ipc-contract';
import { DIAGNOSTICS_OUTPUT_SCHEMAS } from '../../../shared/desktop-diagnostics-ipc-contract';
import type { DesktopSkillStats } from '../../../shared/desktop-diagnostics-ipc-contract';
import type { SkillListDto } from '../../../shared/skill-list-ipc-contract';
const readList = () => api.listSkills(), readStats = () => api.getSkillStats();
function useReadonly<T>(read: () => Promise<T>, schema: ZodType<T>, catalogEvents: boolean) {
  const { locale } = useLocale();
  const [data, setData] = useState<T | null>(null), [failed, setFailed] = useState(false), [reading, setReading] = useState(true);
  type Waiter = { resolve(value: T): void; reject(error: unknown): void };
  type Owner = { active: boolean; busy: boolean; waiters: Waiter[] };
  const life = useRef<Owner | null>(null);
  const runRef = useRef<(owner: Owner, waiters: Waiter[]) => void>(() => {});
  const run = useCallback((owner: Owner, waiters: Waiter[]) => {
    owner.busy = true; setReading(true);
    void (async () => {
      try {
        const value = await read();
        if (!owner.active || life.current !== owner) throw Error('skill_readonly_lifetime_expired');
        const parsed = schema.safeParse(value);
        if (!parsed.success) throw Error('skill_readonly_projection_unavailable');
        setData(parsed.data); setFailed(false);
        for (const waiter of waiters) waiter.resolve(parsed.data);
      } catch (error) {
        if (owner.active && life.current === owner) setFailed(true);
        for (const waiter of waiters) waiter.reject(error);
      }
      finally {
        if (owner.active && life.current === owner) {
          owner.busy = false; setReading(false);
          if (owner.waiters.length) { const queued = owner.waiters.splice(0); runRef.current(owner, queued); }
        }
      }
    })();
  }, [read, schema]);
  runRef.current = run;
  const reload = useCallback((): Promise<T> => new Promise((resolve, reject) => {
    const owner = life.current;
    if (!owner?.active) { reject(Error('skill_readonly_lifetime_expired')); return; }
    const waiter = { resolve, reject };
    if (owner.busy) { owner.waiters.push(waiter); return; }
    runRef.current(owner, [waiter]);
  }), []);
  const refresh = useCallback(() => { void reload().catch(() => {}); }, [reload]);
  useEffect(() => {
    const owner: Owner = { active: true, busy: false, waiters: [] }; life.current = owner; refresh();
    const unsubscribe = catalogEvents ? api.onSkillsChanged?.(() => { if (owner.active && life.current === owner) refresh(); }) : undefined;
    return () => {
      owner.active = false;
      for (const waiter of owner.waiters.splice(0)) waiter.reject(Error('skill_readonly_lifetime_expired'));
      unsubscribe?.();
    };
  }, [locale, refresh, catalogEvents]);
  return { data, failed, reading, refresh, reload };
}
export function useSkillListReadonly() { return useReadonly<SkillListDto>(readList, SKILL_LIST_OUTPUT_SCHEMA, true); }
export function useSkillStatsReadonly() { return useReadonly<DesktopSkillStats[]>(readStats, DIAGNOSTICS_OUTPUT_SCHEMAS.getSkillStats, false); }
